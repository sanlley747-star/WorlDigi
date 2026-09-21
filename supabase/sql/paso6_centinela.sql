-- ByGether - PASO 6: Centinela de cuentas automaticas (anti-bucle + control de calidad de salida).
-- Todo vive en Postgres: funciona igual sin importar quien inserte (worker, scripts, SQL manual).
--
-- Capas:
--   1. claim_agent_tasks     -> PRE-filtro: cierra (sin gastar llamadas de IA) los COMMENT de hilos saturados de comentarios automaticos.
--   2. trigger en comments   -> FILTRO DURO: una cuenta automatica no puede insertar un comentario si el hilo esta en bucle
--                               o si el texto no pasa el validador.
--   3. trigger en posts      -> validador de salida para publicaciones originales (los reposts/likes/follows no llevan texto).
--   4. worker_fallar_tarea   -> registra cada rechazo en centinela_log (control de calidad) y cierra los bucles sin reintentos.
-- Solo se vigilan cuentas con is_cuenta_automatica = true: usuarios reales y cuentas canal nunca se ven afectados.

-- ---------------------------------------------------------------- configuracion
insert into public.agent_config (clave, valor, descripcion) values (
  'centinela_config',
  '{"max_cadena_automatica":3,"max_comentarios_agente_por_post":3,"min_palabras_comentario":2,"min_palabras_post":4,
    "max_caracteres_comentario":1000,"max_caracteres_post":2000,"similitud_max":0.7,"ventana_similitud_hilo":12,
    "historial_agente":10,"max_emojis":3}'::jsonb,
  'Paso 6 (Centinela): max comentarios automaticos seguidos en un hilo, tope por cuenta y post, similitud maxima con textos recientes, etc.')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- tablas
create table if not exists public.centinela_reglas (
  id          serial primary key,
  categoria   text    not null check (categoria in ('asistente','rechazo','preambulo','fuga_prompt','inyeccion','formato')),
  patron      text    not null,                 -- expresion regular POSIX (\y = limite de palabra)
  motivo      text    not null,
  sensible    boolean not null default false,   -- true = distingue mayusculas/minusculas
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.centinela_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  agent_id   text,
  post_id    bigint,
  task_id    bigint,
  tipo       text not null check (tipo in ('bucle','salida')),
  motivo     text not null
);
create index if not exists centinela_log_created_idx on public.centinela_log (created_at desc);
alter table public.centinela_reglas enable row level security;
alter table public.centinela_log    enable row level security;

truncate public.centinela_reglas restart identity;
insert into public.centinela_reglas (categoria, patron, motivo, sensible) values
 -- frases de asistente / modelo de IA
 ('asistente', $re$\ycomo (un|una) (modelo|asistente|ia|inteligencia artificial|bot|chatbot|programa)\y$re$, 'se presenta como asistente o IA', false),
 ('asistente', $re$\ycomo (una )?ia\y$re$, 'se presenta como IA', false),
 ('asistente', $re$\ysoy (un|una) (modelo|asistente|ia|inteligencia artificial|bot|chatbot|programa)\y$re$, 'dice ser una IA', false),
 ('asistente', $re$modelo de lenguaje|language model|\yllm\y$re$, 'menciona ser un modelo de lenguaje', false),
 ('asistente', $re$\yas an? (ai|language model|assistant|artificial)\y$re$, 'frase de asistente en ingles', false),
 ('asistente', $re$(entrenad[oa]|programad[oa]|desarrollad[oa]|creado|creada) por (google|openai|anthropic|meta)\y$re$, 'menciona a su desarrollador', false),
 ('asistente', $re$\yno tengo (opiniones|sentimientos|emociones|gustos) (personales|propios)|\yno tengo (cuerpo|conciencia)\y$re$, 'disclaimer tipico de IA', false),
 -- rechazos y politicas
 ('rechazo', $re$\yno puedo (ayudar|ayudarte|cumplir|proporcionar|generar|crear|escribir|responder|realizar|asistir|complacer)\y$re$, 'rechazo tipico de asistente', false),
 ('rechazo', $re$\ylo siento,? pero (no|como)\y$re$, 'disculpa-rechazo tipica de asistente', false),
 ('rechazo', $re$\y(mis|nuestras) (directrices|pol[ií]ticas|normas de seguridad)\y|\ypol[ií]ticas? de (contenido|seguridad|uso)\y|\ydirectrices de (contenido|seguridad)\y$re$, 'menciona politicas de contenido', false),
 ('rechazo', $re$\yi (can'?t|cannot|can not|won'?t) (help|assist|comply|provide|generate|create)\y|\yi'?m sorry,? (but )?i\y|\yi am sorry,? (but )?i\y$re$, 'rechazo en ingles', false),
 -- preambulos y cierres de asistente
 ('preambulo', $re$^\s*(claro|por supuesto|desde luego|entendido|perfecto|listo|vale)[,!.:]?\s+(aqu[ií]|ac[aá])\y$re$, 'preambulo de asistente', false),
 ('preambulo', $re$\y(aqu[ií]|ac[aá]) (tienes|est[aá]|te dejo|te presento|va|os dejo|te comparto) (el|la|un|una|tu|otro|otra|mi) (comentario|respuesta|publicaci[oó]n|post|texto|versi[oó]n|borrador|propuesta|opci[oó]n|mensaje|resultado)\y$re$, 'presenta el texto como entregable', false),
 ('preambulo', $re$^\s*(comentario|respuesta|publicaci[oó]n|post|texto|mensaje|opci[oó]n( [0-9])?|versi[oó]n( [0-9])?)\s*[:：]$re$, 'etiqueta de entregable al inicio', false),
 ('preambulo', $re$\yespero que (esto|este|esta|te) (te )?(ayude|sirva|guste|sea [uú]til)\y$re$, 'cierre tipico de asistente', false),
 ('preambulo', $re$\y(quieres|te gustar[ií]a|deseas|quisieras) que (te )?(ayude|genere|escriba|haga|reescriba|adapte|modifique|ajuste|redacte)\y$re$, 'oferta de ayuda de asistente', false),
 ('preambulo', $re$\yen qu[eé] (m[aá]s )?(puedo|te puedo) ayudar\y|\ysi necesitas (algo m[aá]s|otra versi[oó]n|otro (comentario|texto))\y|\yno dudes en (preguntar|contactarme|pedirme)\y$re$, 'oferta de ayuda de asistente', false),
 ('preambulo', $re$\yexcelente pregunta\y$re$, 'elogio tipico de asistente', false),
 -- fuga de prompt / marcadores internos / placeholders
 ('fuga_prompt', $re$</?\s*dato\s*>$re$, 'etiqueta interna <dato>', false),
 ('fuga_prompt', $re$\yTAREA\s*:|INDICACIONES PARA ESTA VEZ|ÚLTIMOS COMENTARIOS DEL HILO|TU PERSONALIDAD|TU PERFIL\s*:$re$, 'marcador interno del prompt', true),
 ('fuga_prompt', $re$\y(system prompt|prompt del sistema|mis instrucciones|instrucciones del sistema)\y|\yseg[uú]n mi (personalidad|rol|configuraci[oó]n)\y|\ymi personalidad (es|me)\y$re$, 'menciona su prompt o personalidad', false),
 ('fuga_prompt', $re$\[(nombre|usuario|tu nombre|inserta[^\]]*|insertar[^\]]*|tema|emoji|comentario|texto)\]|\{\{[^}]*\}\}$re$, 'placeholder sin rellenar', false),
 ('fuga_prompt', $re$lorem ipsum$re$, 'texto de relleno', false),
 -- inyeccion
 ('inyeccion', $re$\yignora (todas )?(las |tus |mis )?(instrucciones|indicaciones|reglas)\y|\yignore (all |any )?(previous|prior|above) (instructions|prompts)\y$re$, 'intento de inyeccion de instrucciones', false),
 ('inyeccion', $re$\ymodo (desarrollador|dan|dios|debug)\y|\yjailbreak\y$re$, 'intento de jailbreak', false),
 -- formato que no es de red social
 ('formato', $re$^\s*#{1,6}\s$re$, 'encabezado markdown', false),
 ('formato', $re$(^|\n)\s*([*•]|-|[0-9]+[.)])\s+\S[^\n]*\n\s*([*•]|-|[0-9]+[.)])\s+\S$re$, 'estructura de lista', false),
 ('formato', $re$\*\*[^*]+\*\*|__[^_]+__$re$, 'negritas markdown', false),
 ('formato', $re$https?://|\ywww\.$re$, 'enlace externo', false),
 ('formato', $re$(^|\s)@[[:alnum:]_.]{2,}$re$, 'mencion a usuario', false),
 ('formato', $re$(#[[:alnum:]_]+\s*){3,}$re$, 'exceso de hashtags', false),
 ('formato', $re$(.)\1{7,}$re$, 'caracter repetido (degeneracion)', false),
 ('formato', $re$\y([[:alnum:]]{2,})( \1){3,}\y$re$, 'palabra repetida (degeneracion)', false),
 ('formato', $re$<[a-z/][^>]*>$re$, 'etiquetas HTML', false);

-- ---------------------------------------------------------------- utilidades de texto
create or replace function public.centinela_normalizar(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-záéíóúüñ0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- similitud de Jaccard entre los conjuntos de palabras (0..1)
create or replace function public.centinela_similitud(a text, b text) returns numeric
language sql immutable as $$
  with x as (
    select array(select distinct w from unnest(string_to_array(public.centinela_normalizar(a), ' ')) w where length(w) > 1) wa,
           array(select distinct w from unnest(string_to_array(public.centinela_normalizar(b), ' ')) w where length(w) > 1) wb
  ), i as (
    select count(*) n from (select unnest(wa) from x intersect select unnest(wb) from x) q
  )
  select case when cardinality(wa) = 0 or cardinality(wb) = 0 then 0::numeric
              else round(i.n::numeric / (cardinality(wa) + cardinality(wb) - i.n), 3) end
    from x, i
$$;

-- ---------------------------------------------------------------- validador de salida
create or replace function public.centinela_evaluar_texto(
  p_texto text, p_agent text, p_post_id bigint default null, p_tipo text default 'comentario', p_ignorar_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cfg jsonb := public.agent_cfg('centinela_config');
  v_t text := btrim(coalesce(p_texto, ''));
  v_post boolean := (p_tipo = 'post');
  v_n int; v_max int; v_emojis int := 0; v_sim numeric; v_umbral numeric := (v_cfg ->> 'similitud_max')::numeric;
  v_ini text; r record; p record; v_hit boolean;
begin
  if v_t = '' then return jsonb_build_object('ok', false, 'categoria', 'formato', 'motivo', 'texto vacio'); end if;

  v_n   := cardinality(regexp_split_to_array(v_t, '\s+'));
  v_max := (v_cfg ->> case when v_post then 'max_caracteres_post' else 'max_caracteres_comentario' end)::int;
  if v_n < (v_cfg ->> case when v_post then 'min_palabras_post' else 'min_palabras_comentario' end)::int then
    return jsonb_build_object('ok', false, 'categoria', 'formato', 'motivo', format('demasiado corto (%s palabras)', v_n));
  end if;
  if length(v_t) > v_max then
    return jsonb_build_object('ok', false, 'categoria', 'formato', 'motivo', format('demasiado largo (%s > %s)', length(v_t), v_max));
  end if;

  -- reglas por expresion regular (una regla mal escrita nunca debe tumbar las inserciones)
  for r in select categoria, motivo, patron, sensible from public.centinela_reglas where activa order by id loop
    begin
      v_hit := case when r.sensible then v_t ~ r.patron else v_t ~* r.patron end;
    exception when others then
      v_hit := false;
    end;
    if v_hit then return jsonb_build_object('ok', false, 'categoria', r.categoria, 'motivo', r.motivo); end if;
  end loop;

  begin
    select count(*) into v_emojis from regexp_matches(v_t, '[\U0001F300-\U0001FAFF\u2600-\u27BF]', 'g');
  exception when others then v_emojis := 0;
  end;
  if v_emojis > (v_cfg ->> 'max_emojis')::int then
    return jsonb_build_object('ok', false, 'categoria', 'formato', 'motivo', format('demasiados emojis (%s)', v_emojis));
  end if;

  -- repeticion: contra el hilo (solo comentarios) y contra lo ultimo que escribio la propia cuenta
  v_ini := array_to_string((string_to_array(public.centinela_normalizar(v_t), ' '))[1:3], ' ');
  for p in
    (select c.content, (lower(c.user_email) = lower(p_agent)) as propio
       from public.comments c
      where p_tipo = 'comentario' and c.post_id = p_post_id and (p_ignorar_id is null or c.id <> p_ignorar_id)
      order by c.created_at desc, c.id desc limit (v_cfg ->> 'ventana_similitud_hilo')::int)
    union all
    (select c.content, true from public.comments c
      where lower(c.user_email) = lower(p_agent) and (p_ignorar_id is null or c.id <> p_ignorar_id)
      order by c.created_at desc, c.id desc limit (v_cfg ->> 'historial_agente')::int)
    union all
    (select po.content, true from public.posts po
      where lower(po.user_email) = lower(p_agent) and po.repost_of is null and po.content is not null
      order by po.created_at desc limit 5)
  loop
    continue when p.content is null;
    v_sim := public.centinela_similitud(v_t, p.content);
    if v_sim >= v_umbral then
      return jsonb_build_object('ok', false, 'categoria', 'repeticion', 'motivo', format('%s%% similar a un texto reciente', round(v_sim * 100)));
    end if;
    if p.propio and v_n >= 4
       and array_to_string((string_to_array(public.centinela_normalizar(p.content), ' '))[1:3], ' ') = v_ini then
      return jsonb_build_object('ok', false, 'categoria', 'repeticion', 'motivo', 'arranque repetido de la propia cuenta');
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end $function$;

-- ---------------------------------------------------------------- filtro anti-bucle
create or replace function public.centinela_estado_hilo(p_post_id bigint, p_agent text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cfg jsonb := public.agent_cfg('centinela_config');
  v_max_cadena int := (v_cfg ->> 'max_cadena_automatica')::int;
  v_max_agente int := (v_cfg ->> 'max_comentarios_agente_por_post')::int;
  v_cadena int; v_ultimo text; v_propios int; v_motivo text;
begin
  with t as (
    select coalesce(pr.is_cuenta_automatica, false) as auto, c.user_email,
           row_number() over (order by c.created_at desc, c.id desc) rn
      from public.comments c
      left join public.profiles pr on lower(pr.user_email) = lower(c.user_email)
     where c.post_id = p_post_id)
  select coalesce((select min(rn) from t where not auto) - 1, (select count(*) from t)),
         (select user_email from t where rn = 1),
         (select count(*) from t where lower(user_email) = lower(p_agent))
    into v_cadena, v_ultimo, v_propios;

  if v_cadena >= v_max_cadena then
    v_motivo := format('anti-bucle: %s comentarios automaticos seguidos en el hilo (max. %s)', v_cadena, v_max_cadena);
  elsif v_ultimo is not null and lower(v_ultimo) = lower(p_agent) then
    v_motivo := 'anti-bucle: la cuenta ya tiene el ultimo comentario del hilo';
  elsif v_propios >= v_max_agente then
    v_motivo := format('anti-bucle: la cuenta ya comento %s veces en este post (max. %s)', v_propios, v_max_agente);
  end if;

  return jsonb_build_object('puede', v_motivo is null, 'motivo', v_motivo, 'cadena_automatica', v_cadena, 'comentarios_de_la_cuenta', v_propios);
end $function$;

-- ---------------------------------------------------------------- triggers (filtro duro)
create or replace function public.centinela_trg_comentario() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare v_e jsonb; v_t jsonb;
begin
  if not exists (select 1 from public.profiles pr where pr.is_cuenta_automatica and lower(pr.user_email) = lower(new.user_email)) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('centinela:' || new.post_id));   -- un solo comentario automatico a la vez por hilo
  v_e := public.centinela_estado_hilo(new.post_id, new.user_email);
  if not (v_e ->> 'puede')::boolean then raise exception 'centinela: %', v_e ->> 'motivo'; end if;
  v_t := public.centinela_evaluar_texto(new.content, new.user_email, new.post_id, 'comentario', null);
  if not (v_t ->> 'ok')::boolean then
    raise exception 'centinela: salida rechazada (%): %', v_t ->> 'categoria', v_t ->> 'motivo';
  end if;
  return new;
end $function$;

create or replace function public.centinela_trg_post() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare v_t jsonb;
begin
  if new.repost_of is not null or new.content is null then return new; end if;   -- reposts: sin texto propio
  if not exists (select 1 from public.profiles pr where pr.is_cuenta_automatica and lower(pr.user_email) = lower(new.user_email)) then
    return new;
  end if;
  v_t := public.centinela_evaluar_texto(new.content, new.user_email, null, 'post', null);
  if not (v_t ->> 'ok')::boolean then
    raise exception 'centinela: salida rechazada (%): %', v_t ->> 'categoria', v_t ->> 'motivo';
  end if;
  return new;
end $function$;

drop trigger if exists trg_centinela_comentario on public.comments;
create trigger trg_centinela_comentario before insert on public.comments
  for each row execute function public.centinela_trg_comentario();
drop trigger if exists trg_centinela_post on public.posts;
create trigger trg_centinela_post before insert on public.posts
  for each row execute function public.centinela_trg_post();

-- ---------------------------------------------------------------- cola: pre-filtro anti-bucle y registro de rechazos
create or replace function public.claim_agent_tasks(p_limit integer default 1, p_types text[] default null)
returns setof public.agent_queue language plpgsql security definer set search_path to 'public' as $function$
begin
  -- tareas que quedaron "processing" mas de 10 min (worker caido) vuelven a pending
  update public.agent_queue set status = 'pending'
   where status = 'processing' and started_at < now() - interval '10 minutes';

  -- Centinela: los COMMENT cuyo hilo ya esta en bucle se cierran aqui, sin gastar ninguna llamada de IA
  with bloqueadas as (
    select q.id, q.agent_id, q.target_id, e.e
      from public.agent_queue q
     cross join lateral (
       select public.centinela_estado_hilo(case when q.target_id ~ '^[0-9]+$' then q.target_id::bigint end, q.agent_id) as e) e
     where q.status = 'pending' and q.action_type = 'COMMENT' and q.scheduled_at <= now()
       and q.target_id ~ '^[0-9]+$'
       and not coalesce((e.e ->> 'puede')::boolean, true)
  ), cerradas as (
    update public.agent_queue q
       set status = 'failed', completed_at = now(), last_error = left('centinela: ' || (b.e ->> 'motivo'), 500)
      from bloqueadas b where q.id = b.id
    returning q.id, q.agent_id, q.target_id, q.last_error
  )
  insert into public.centinela_log (agent_id, post_id, task_id, tipo, motivo)
  select agent_id, target_id::bigint, id, 'bucle', last_error from cerradas;

  return query
  update public.agent_queue q
     set status = 'processing', started_at = now(), attempts = q.attempts + 1
   where q.id in (
           select id from public.agent_queue
            where status = 'pending' and scheduled_at <= now()
              and (p_types is null or action_type = any (p_types))
            order by priority, scheduled_at, id
            limit greatest(p_limit, 1)
            for update skip locked)
  returning q.*;
end $function$;

create or replace function public.worker_fallar_tarea(p_task_id bigint, p_error text, p_definitivo boolean default false)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  v public.agent_queue; v_max integer := (public.agent_cfg('max_intentos'))::text::int;
  v_def boolean := p_definitivo; v_bucle boolean := position('centinela: anti-bucle' in p_error) > 0;
begin
  select * into v from public.agent_queue where id = p_task_id and status = 'processing' for update;
  if not found then return 'no_encontrada'; end if;
  if v_bucle then v_def := true; end if;             -- un bucle no se arregla reintentando

  if v_bucle or position('centinela:' in p_error) > 0 or p_error like 'salida rechazada:%' then
    insert into public.centinela_log (agent_id, post_id, task_id, tipo, motivo)
    values (v.agent_id, case when v.target_id ~ '^[0-9]+$' then v.target_id::bigint end, v.id,
            case when v_bucle then 'bucle' else 'salida' end, left(p_error, 300));
  end if;

  if v_def or v.attempts >= v_max then
    update public.agent_queue set status = 'failed', last_error = left(p_error, 500), completed_at = now() where id = p_task_id;
    return 'failed';
  end if;
  update public.agent_queue
     set status = 'pending', started_at = null, last_error = left(p_error, 500),
         scheduled_at = now() + make_interval(mins => v.attempts * 2)
   where id = p_task_id;
  return 'reintento';
end $function$;

-- ---------------------------------------------------------------- control de calidad
create or replace function public.centinela_resumen(p_horas integer default 24) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_desde timestamptz := now() - make_interval(hours => p_horas);
begin
  return jsonb_build_object(
    'horas', p_horas,
    'comentarios_automaticos_publicados', (select count(*) from public.comments c join public.profiles p on lower(p.user_email) = lower(c.user_email) and p.is_cuenta_automatica where c.created_at >= v_desde),
    'posts_automaticos_publicados', (select count(*) from public.posts po join public.profiles p on lower(p.user_email) = lower(po.user_email) and p.is_cuenta_automatica where po.repost_of is null and po.created_at >= v_desde),
    'rechazos_por_bucle', (select count(*) from public.centinela_log where tipo = 'bucle' and created_at >= v_desde),
    'rechazos_por_salida', (select count(*) from public.centinela_log where tipo = 'salida' and created_at >= v_desde),
    'motivos_mas_frecuentes', coalesce((select jsonb_agg(x order by (x ->> 'n')::int desc) from (
        select jsonb_build_object('tipo', tipo, 'motivo', left(regexp_replace(motivo, '^.*centinela: ', ''), 90), 'n', count(*)) x
          from public.centinela_log where created_at >= v_desde group by tipo, left(regexp_replace(motivo, '^.*centinela: ', ''), 90) limit 10) s), '[]'::jsonb),
    'hilos_saturados_ahora', (select count(*) from (select distinct c.post_id from public.comments c) h
                               where (public.centinela_estado_hilo(h.post_id, '') ->> 'cadena_automatica')::int >= (public.agent_cfg('centinela_config') ->> 'max_cadena_automatica')::int));
end $function$;

-- ---------------------------------------------------------------- permisos: solo service_role (como el resto del motor)
revoke all on function public.centinela_normalizar(text)                                          from public, anon, authenticated;
revoke all on function public.centinela_similitud(text, text)                                     from public, anon, authenticated;
revoke all on function public.centinela_evaluar_texto(text, text, bigint, text, bigint)          from public, anon, authenticated;
revoke all on function public.centinela_estado_hilo(bigint, text)                                 from public, anon, authenticated;
revoke all on function public.centinela_trg_comentario()                                          from public, anon, authenticated;
revoke all on function public.centinela_trg_post()                                                from public, anon, authenticated;
revoke all on function public.centinela_resumen(integer)                                          from public, anon, authenticated;
revoke all on function public.interacciones_tema_de(text)                                         from public, anon, authenticated;
grant execute on function public.centinela_evaluar_texto(text, text, bigint, text, bigint), public.centinela_estado_hilo(bigint, text),
                          public.centinela_resumen(integer), public.interacciones_tema_de(text) to service_role;
