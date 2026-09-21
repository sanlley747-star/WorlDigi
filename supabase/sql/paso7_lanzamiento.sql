-- ByGether - PASO 7: lanzamiento y simulacion de trafico sintetico (cuentas automaticas).
--
-- Copia versionada de lo que esta desplegado en Supabase (proyecto ByKonet). Contiene:
--   1. Configuracion del planificador y de las imagenes propias (agent_config)
--   2. worker_cupo_imagen()      cupo propio de imagenes (diario, por minuto y corte tras 3 fallos seguidos)
--   3. worker_completar_post()   publica el POST (con imagen opcional del bucket posts-images) y cierra la tarea
--   4. planificador_sembrar()    inyecta la semilla inicial: 50 tareas POST repartidas en la ventana horaria
--   5. planificador_tick()       crea POST / COMMENT de forma continua (lo llama pg_cron cada minuto)
--   6. pg_cron 'planificador-tick'
--
-- Requiere los pasos 1-6 (tablas profiles / agent_queue / agent_config, funciones agent_cfg, worker_*,
-- interacciones_cuentas_activas, centinela_estado_hilo, etc.).
--
-- Lanzamiento:
--   select public.planificador_sembrar(50, true);    -- ensayo (no inserta)
--   select public.planificador_sembrar(50);          -- siembra las 50 tareas
--   update public.agent_config set valor = 'true'::jsonb where clave in ('worker_activo', 'planificador_activo');
--
-- Interruptores de emergencia (false = pausa total):
--   update public.agent_config set valor = 'false'::jsonb where clave = 'planificador_activo';
--   update public.agent_config set valor = 'false'::jsonb where clave = 'worker_activo';

-- ---------------------------------------------------------------- 1. Configuracion
insert into public.agent_config (clave, valor, descripcion) values
  ('planificador_activo', 'true'::jsonb,
   'Interruptor del planificador (crea tareas POST/COMMENT en agent_queue de forma continua). ACTIVO desde el lanzamiento (paso 7); false = pausa total.'),
  ('planificador_diario', '{"post": 90, "comment": 500}'::jsonb,
   'Objetivo diario de tareas por tipo; se reparte con curva_horaria (el resto del presupuesto de 1100 queda para vision y reintentos)'),
  ('planificador_limites', '{"max_pendientes": 30, "prob_respuesta_autor": 0.25, "min_horas_entre_posts": 8, "ventana_comentarios_horas": 24, "max_tareas_pendientes_por_post": 2}'::jsonb,
   'Limites de realismo del planificador'),
  ('planificador_niveles', '{"alta": {"posts_dia": 2, "comentarios_dia": 14}, "baja": {"posts_dia": 1, "comentarios_dia": 2}, "media": {"posts_dia": 1, "comentarios_dia": 7}}'::jsonb,
   'Topes diarios por cuenta segun su nivel de actividad'),
  ('modelo_imagen', '"gemini-2.5-flash-image"'::jsonb,
   'Modelo de Gemini que genera las fotos de las publicaciones'),
  ('imagenes_activas', 'false'::jsonb,
   'Interruptor de las imagenes propias en publicaciones de cuentas automaticas (false = solo texto). APAGADO temporalmente: Google AI Studio responde 429 de cuota a todos los modelos de imagen (plan gratuito). Poner en true cuando se active facturacion.'),
  ('imagenes_diarias', '60'::jsonb,
   'Maximo de imagenes generadas por dia (no cuenta contra el presupuesto de texto)'),
  ('imagenes_prob_post', '0.35'::jsonb,
   'Probabilidad de que una publicacion automatica lleve imagen'),
  ('imagenes_rpm_max', '4'::jsonb,
   'Maximo de imagenes por minuto')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------- 2. Cupo de imagenes
CREATE OR REPLACE FUNCTION public.worker_cupo_imagen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz  text := trim(both '"' from (public.agent_cfg('zona_horaria'))::text);
  v_dia_ini timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_max int := coalesce((public.agent_cfg('imagenes_diarias'))::text::int, 0);
  v_rpm int := coalesce((public.agent_cfg('imagenes_rpm_max'))::text::int, 4);
  v_act boolean := coalesce((public.agent_cfg('imagenes_activas'))::text::boolean, false);
  v_dia int; v_min int; v_fallos int; v_ult timestamptz; v_ok boolean;
begin
  select count(*) into v_dia from public.agent_llm_calls where tipo = 'imagen' and created_at >= v_dia_ini;
  select count(*) into v_min from public.agent_llm_calls where tipo = 'imagen' and created_at > now() - interval '60 seconds';
  select count(*) filter (where ok is false), max(created_at) into v_fallos, v_ult
    from (select ok, created_at from public.agent_llm_calls where tipo = 'imagen' order by created_at desc limit 3) x;
  v_ok := v_act and v_dia < v_max and v_min < v_rpm and not (coalesce(v_fallos, 0) = 3 and v_ult > now() - interval '15 minutes');
  return jsonb_build_object('ok', v_ok, 'activas', v_act, 'usadas_dia', v_dia, 'max_dia', v_max, 'fallos_seguidos', coalesce(v_fallos, 0));
end $function$;

-- ---------------------------------------------------------------- 3. Publicar un POST (con imagen opcional)
CREATE OR REPLACE FUNCTION public.worker_completar_post(p_task_id bigint, p_agent_email text, p_content text, p_image_url text DEFAULT NULL::text, p_image_desc text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_id bigint; v_img text := nullif(btrim(coalesce(p_image_url, '')), '');
begin
  perform 1 from public.agent_queue where id = p_task_id and status = 'processing' and agent_id = p_agent_email for update;
  if not found then raise exception 'la tarea % no esta en processing para %', p_task_id, p_agent_email; end if;
  select user_name into v_name from public.profiles where user_email = p_agent_email and is_cuenta_automatica;
  if v_name is null then raise exception 'cuenta automatica inexistente: %', p_agent_email; end if;
  if p_content is null or length(btrim(p_content)) = 0 or length(p_content) > 2000 then raise exception 'contenido invalido'; end if;
  if v_img is not null and v_img not like 'https://aiymadawznadvavzspxj.supabase.co/storage/v1/object/public/posts-images/%' then
    raise exception 'imagen invalida: solo se aceptan archivos del bucket posts-images';
  end if;
  insert into public.posts (user_email, user_name, content, image_url) values (p_agent_email, v_name, btrim(p_content), v_img) returning id into v_id;
  if v_img is not null and p_image_desc is not null and length(btrim(p_image_desc)) > 0 then
    insert into public.post_image_desc (post_id, descripcion, modelo) values (v_id, left(btrim(p_image_desc), 300), 'generada')
    on conflict (post_id) do nothing;
  end if;
  update public.agent_queue set status = 'completed', completed_at = now(), last_error = null, target_id = coalesce(target_id, v_id::text) where id = p_task_id;
  return v_id;
end $function$;

-- ---------------------------------------------------------------- 4. Semilla inicial (50 tareas)
CREATE OR REPLACE FUNCTION public.planificador_sembrar(p_n integer DEFAULT 50, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz    text    := public.agent_cfg('zona_horaria') #>> '{}';
  v_ini   numeric := (public.agent_cfg('ventana_horaria') ->> 'inicio')::numeric;
  v_fin   numeric := (public.agent_cfg('ventana_horaria') ->> 'fin')::numeric;
  v_nivi  jsonb   := public.agent_cfg('interacciones_niveles');
  v_local timestamp := now() at time zone v_tz;
  v_hdec  numeric := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_base  timestamp := case when extract(hour from v_local) >= 21 then date_trunc('day', v_local) + interval '1 day' else date_trunc('day', v_local) end;
  v_prob  numeric := case when coalesce((public.agent_cfg('imagenes_activas'))::text::boolean, false)
                          then coalesce((public.agent_cfg('imagenes_prob_post'))::text::numeric, 0) else 0 end;
  v_res jsonb;
begin
  with cuentas as (
    select p.user_email,
           p.config_cuenta_automatica ->> 'tema_principal' as tema,
           coalesce(p.config_cuenta_automatica -> 'actividad' ->> 'nivel', 'media') as nivel,
           greatest(coalesce((p.config_cuenta_automatica -> 'actividad' -> 'horas_activas' ->> 0)::numeric, 7), v_ini) as h0,
           least(coalesce((p.config_cuenta_automatica -> 'actividad' -> 'horas_activas' ->> 1)::numeric, 23), v_fin) as h1
      from public.profiles p
     where p.is_cuenta_automatica
       and not exists (select 1 from public.agent_queue q where q.agent_id = p.user_email and q.action_type = 'POST' and q.status in ('pending', 'processing'))
       and not exists (select 1 from public.posts po where po.user_email = p.user_email and po.repost_of is null and po.created_at > now() - interval '8 hours')
  ), ordenadas as (
    select c.*,
           row_number() over (partition by c.tema order by -ln(1 - random()) / (v_nivi -> c.nivel ->> 'peso')::numeric) as rn_tema,
           random() as azar
      from cuentas c
  ), elegidas as (
    select * from ordenadas order by rn_tema, azar limit greatest(p_n, 0)
  ), programadas as (
    select e.user_email, e.tema, e.nivel,
           case
             when v_base::date = v_local::date and false then null
             when extract(hour from v_local) >= 21 and e.h1 > v_hdec + 0.1
               then now() + interval '1 minute' + random() * (least(e.h1, v_fin) - v_hdec - 0.02) * interval '1 hour'
             else (v_base + make_interval(secs => (e.h0 + random() * greatest(e.h1 - e.h0, 1)) * 3600)) at time zone v_tz
           end as cuando,
           (random() < v_prob) as con_imagen
      from elegidas e
  ), ajustadas as (
    select pr.user_email, pr.tema, pr.nivel, pr.con_imagen,
           case when pr.cuando < now() + interval '1 minute' then now() + interval '1 minute' + random() * interval '20 minutes' else pr.cuando end as cuando
      from programadas pr
  ), ins as (
    insert into public.agent_queue (agent_id, action_type, target_id, priority, scheduled_at, payload)
    select a.user_email, 'POST', null, 2, a.cuando,
           jsonb_build_object('tema', a.tema, 'imagen', a.con_imagen, 'origen', 'semilla')
      from ajustadas a
     where not p_dry_run
    returning agent_id, scheduled_at, payload
  )
  select jsonb_build_object(
           'dry_run', p_dry_run,
           'solicitadas', p_n,
           'insertadas', (select count(*) from ins),
           'candidatas', (select count(*) from ajustadas),
           'con_imagen', (select count(*) from ajustadas where con_imagen),
           'hoy_en_minutos', (select count(*) from ajustadas where cuando < now() + interval '30 minutes'),
           'temas', (select count(distinct tema) from ajustadas))
    into v_res;
  return v_res;
end $function$;

-- ---------------------------------------------------------------- 5. Planificador continuo
CREATE OR REPLACE FUNCTION public.planificador_tick(p_forzar boolean DEFAULT false, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz    text    := public.agent_cfg('zona_horaria') #>> '{}';
  v_ini   numeric := (public.agent_cfg('ventana_horaria') ->> 'inicio')::numeric;
  v_fin   numeric := (public.agent_cfg('ventana_horaria') ->> 'fin')::numeric;
  v_curva jsonb   := public.agent_cfg('curva_horaria');
  v_diario jsonb  := public.agent_cfg('planificador_diario');
  v_lim   jsonb   := public.agent_cfg('planificador_limites');
  v_nivp  jsonb   := public.agent_cfg('planificador_niveles');
  v_nivi  jsonb   := public.agent_cfg('interacciones_niveles');
  v_ilim  jsonb   := public.agent_cfg('interacciones_limites');
  v_max_cadena int := (public.agent_cfg('centinela_config') ->> 'max_cadena_automatica')::int;
  v_local timestamp := now() at time zone v_tz;
  v_h     integer := extract(hour from v_local)::int;
  v_hdec  numeric := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_hora_ini timestamptz := date_trunc('hour', v_local) at time zone v_tz;
  v_dia   timestamptz := date_trunc('day', v_local) at time zone v_tz;
  v_peso numeric; v_suma numeric; v_quota numeric; v_usadas integer; v_min_rest numeric; v_esperado numeric;
  v_pend integer; v_n integer; i integer; t text;
  v_acc jsonb := '[]'::jsonb;
  v_creadas jsonb := jsonb_build_object('post', 0, 'comment', 0);
  a record; p record;
  v_hay boolean; v_prio smallint; v_resp bigint; v_payload jsonb; v_sched timestamptz; v_img boolean;
begin
  if not p_forzar then
    if not coalesce((public.agent_cfg('planificador_activo'))::text::boolean, false) then return jsonb_build_object('estado', 'desactivado'); end if;
    if not coalesce((public.agent_cfg('worker_activo'))::text::boolean, false) then return jsonb_build_object('estado', 'worker_apagado'); end if;
    if not pg_try_advisory_xact_lock(hashtext('planificador_tick')) then return jsonb_build_object('estado', 'ocupado'); end if;
    if v_hdec < v_ini or v_hdec >= v_fin then return jsonb_build_object('estado', 'fuera_de_horario', 'hora_local', to_char(v_local, 'HH24:MI')); end if;
  end if;

  -- Cola actual (las tareas sembradas para mas tarde no cuentan hasta que se acercan)
  select count(*) into v_pend from public.agent_queue
   where action_type in ('POST', 'COMMENT')
     and (status = 'processing' or (status = 'pending' and scheduled_at <= now() + interval '15 minutes'));
  if not p_forzar and v_pend >= (v_lim ->> 'max_pendientes')::int then
    return jsonb_build_object('estado', 'cola_llena', 'pendientes', v_pend);
  end if;

  select coalesce(sum(value::numeric), 0) into v_suma from jsonb_each_text(v_curva)
   where key::numeric >= floor(v_ini) and key::numeric < v_fin;
  v_peso := coalesce((v_curva ->> v_h::text)::numeric, 0);

  foreach t in array array['post', 'comment'] loop
    if p_forzar then
      v_n := 1;
    else
      select count(*) into v_usadas from public.agent_queue q
       where q.action_type = upper(t) and q.scheduled_at >= v_hora_ini and q.scheduled_at < v_hora_ini + interval '1 hour';
      v_quota    := coalesce((v_diario ->> t)::numeric, 0) * v_peso / nullif(v_suma, 0);
      v_min_rest := greatest((least(v_h + 1, v_fin) - v_hdec) * 60, 1);
      v_esperado := greatest(coalesce(v_quota, 0) - v_usadas, 0) / v_min_rest;
      v_n := least(floor(v_esperado)::int + case when random() < v_esperado - floor(v_esperado) then 1 else 0 end,
                   case when t = 'post' then 2 else 4 end);
    end if;

    for i in 1..v_n loop
      -- ============================ POST ============================
      if t = 'post' then
        select c.user_email, c.user_name, c.nivel, c.tema into a
          from public.interacciones_cuentas_activas() c
         where (select count(*) from public.posts po where po.user_email = c.user_email and po.repost_of is null and po.created_at >= v_dia)
                 < coalesce((v_nivp -> c.nivel ->> 'posts_dia')::int, 1)
           and not exists (select 1 from public.posts po where po.user_email = c.user_email and po.repost_of is null
                             and po.created_at > now() - make_interval(hours => (v_lim ->> 'min_horas_entre_posts')::int))
           and not exists (select 1 from public.agent_queue q where q.agent_id = c.user_email and q.action_type = 'POST' and q.status in ('pending', 'processing'))
         order by -ln(1 - random()) / (v_nivi -> c.nivel ->> 'peso')::numeric
         limit 1;
        if not found then v_acc := v_acc || jsonb_build_object('tipo', 'post', 'hecho', false, 'motivo', 'sin_cuentas_elegibles'); exit; end if;

        v_img := coalesce((public.agent_cfg('imagenes_activas'))::text::boolean, false)
                 and random() < coalesce((public.agent_cfg('imagenes_prob_post'))::text::numeric, 0);
        v_sched := now() + random() * interval '60 seconds';
        if not p_dry_run then
          insert into public.agent_queue (agent_id, action_type, target_id, priority, scheduled_at, payload)
          values (a.user_email, 'POST', null, 2, v_sched,
                  jsonb_build_object('tema', a.tema, 'imagen', v_img, 'origen', 'planificador'));
        end if;
        v_creadas := jsonb_set(v_creadas, '{post}', to_jsonb((v_creadas ->> 'post')::int + 1));
        v_acc := v_acc || jsonb_build_object('tipo', 'post', 'hecho', true, 'cuenta', a.user_email, 'tema', a.tema, 'imagen', v_img);

      -- ============================ COMMENT ============================
      else
        -- 1) Publicacion a comentar: cualquier autor (automatica, canal o real) con los mismos criterios; los usuarios reales pesan mas.
        with cand as (
          select po.id, po.user_email as autor_email, po.created_at,
                 exists (select 1 from public.profiles pr where pr.is_cuenta_automatica and lower(pr.user_email) = lower(po.user_email)) as autor_auto,
                 exists (select 1 from public.cuentas_canal cc where lower(cc.user_email) = lower(po.user_email)) as autor_canal,
                 (select count(*) from public.comments cm where cm.post_id = po.id) as n_com,
                 (select count(*) from public.agent_queue q where q.action_type = 'COMMENT' and q.status in ('pending', 'processing') and q.target_id = po.id::text) as n_pend,
                 -- ultimo comentario de un usuario real (ni automatico ni canal) que todavia no tiene respuesta automatica posterior
                 (select cm.id from public.comments cm
                   where cm.post_id = po.id
                     and not exists (select 1 from public.profiles pr where pr.is_cuenta_automatica and lower(pr.user_email) = lower(cm.user_email))
                     and not exists (select 1 from public.cuentas_canal cc where lower(cc.user_email) = lower(cm.user_email))
                     and not exists (select 1 from public.comments c2 join public.profiles pr2 on lower(pr2.user_email) = lower(c2.user_email) and pr2.is_cuenta_automatica
                                      where c2.post_id = po.id and c2.id > cm.id)
                   order by cm.id desc limit 1) as real_sin_respuesta
            from public.posts po
           where po.repost_of is null
             and po.created_at <= now() - make_interval(secs => (v_ilim ->> 'edad_min_post_seg')::int)
             and po.created_at >= now() - make_interval(hours => (v_lim ->> 'ventana_comentarios_horas')::int)
        )
        select cd.*, (not cd.autor_auto and not cd.autor_canal) as autor_real into p
          from cand cd
         where cd.n_pend < (v_lim ->> 'max_tareas_pendientes_por_post')::int
           and coalesce((public.centinela_estado_hilo(cd.id, '') ->> 'cadena_automatica')::int, 0) + cd.n_pend < v_max_cadena
         order by -ln(1 - random()) / (
                  exp(-extract(epoch from now() - cd.created_at) / 36000.0)
                * case when not cd.autor_auto and not cd.autor_canal then 6.0 when cd.autor_canal then 1.5 else 1.0 end
                * case when cd.real_sin_respuesta is not null then 8.0 else 1.0 end
                / (1 + 0.5 * cd.n_com))
         limit 1;
        if not found then v_acc := v_acc || jsonb_build_object('tipo', 'comment', 'hecho', false, 'motivo', 'sin_posts_elegibles'); exit; end if;

        -- 2) Cuenta que comenta. A veces el autor (si es automatico) responde a quien lo comento.
        v_hay := false; v_resp := null;
        if p.autor_auto and p.n_com > 0 and random() < (v_lim ->> 'prob_respuesta_autor')::numeric then
          select c.user_email, c.user_name, c.nivel, c.tema into a
            from public.interacciones_cuentas_activas() c
           where lower(c.user_email) = lower(p.autor_email)
             and (select count(*) from public.comments cm where cm.user_email = c.user_email and cm.created_at >= v_dia)
                 + (select count(*) from public.agent_queue q where q.agent_id = c.user_email and q.action_type = 'COMMENT' and q.created_at >= v_dia and q.status in ('pending', 'processing'))
                   < coalesce((v_nivp -> c.nivel ->> 'comentarios_dia')::int, 2)
             and coalesce((public.centinela_estado_hilo(p.id, c.user_email) ->> 'puede')::boolean, true);
          v_hay := found;
          if v_hay then
            select cm.id into v_resp from public.comments cm
             where cm.post_id = p.id and lower(cm.user_email) <> lower(p.autor_email) order by cm.id desc limit 1;
            if v_resp is null then v_hay := false; end if;
          end if;
        end if;

        if not v_hay then
          select c.user_email, c.user_name, c.nivel, c.tema into a
            from public.interacciones_cuentas_activas() c
           where lower(c.user_email) <> lower(p.autor_email)
             and (select count(*) from public.comments cm where cm.user_email = c.user_email and cm.created_at >= v_dia)
                 + (select count(*) from public.agent_queue q where q.agent_id = c.user_email and q.action_type = 'COMMENT' and q.created_at >= v_dia and q.status in ('pending', 'processing'))
                   < coalesce((v_nivp -> c.nivel ->> 'comentarios_dia')::int, 2)
             and not exists (select 1 from public.agent_queue q where q.agent_id = c.user_email and q.action_type = 'COMMENT'
                               and q.target_id = p.id::text and q.status in ('pending', 'processing'))
             and coalesce((public.centinela_estado_hilo(p.id, c.user_email) ->> 'puede')::boolean, true)
           order by -ln(1 - random()) / (
                    (v_nivi -> c.nivel ->> 'peso')::numeric
                  * case when c.tema is not null and public.interacciones_tema_de(p.autor_email) = c.tema then 2.5 else 1.0 end
                  * case when exists (select 1 from public.connections cn where lower(cn.follower_email) = lower(c.user_email)
                                         and lower(cn.following_email) = lower(p.autor_email)) then 3.0 else 1.0 end)
           limit 1;
          if not found then v_acc := v_acc || jsonb_build_object('tipo', 'comment', 'hecho', false, 'motivo', 'sin_cuentas_elegibles', 'post_id', p.id); exit; end if;

          -- Hilo natural: responde a un usuario real que aun no tiene respuesta, o (a veces) al ultimo comentario
          if p.real_sin_respuesta is not null then
            v_resp := p.real_sin_respuesta;
          elsif p.n_com > 0 and random() < 0.35 then
            select cm.id into v_resp from public.comments cm
             where cm.post_id = p.id and lower(cm.user_email) <> lower(a.user_email) order by cm.id desc limit 1;
          end if;
        end if;

        v_prio := case when p.autor_real or p.real_sin_respuesta is not null then 1 else 2 end;
        v_sched := now() + case when v_prio = 1 then random() * interval '40 seconds' + interval '5 seconds'
                                else random() * interval '130 seconds' + interval '20 seconds' end;
        v_payload := jsonb_build_object('origen', 'planificador') || case when v_resp is not null then jsonb_build_object('responder_a', v_resp) else '{}'::jsonb end;
        if not p_dry_run then
          insert into public.agent_queue (agent_id, action_type, target_id, priority, scheduled_at, payload)
          values (a.user_email, 'COMMENT', p.id::text, v_prio, v_sched, v_payload);
        end if;
        v_creadas := jsonb_set(v_creadas, '{comment}', to_jsonb((v_creadas ->> 'comment')::int + 1));
        v_acc := v_acc || jsonb_build_object('tipo', 'comment', 'hecho', true, 'cuenta', a.user_email, 'post_id', p.id,
                   'autor_post', case when p.autor_real then 'real' when p.autor_canal then 'canal' else 'automatica' end,
                   'prioridad', v_prio, 'responde_a', v_resp);
      end if;
    end loop;
  end loop;

  return jsonb_build_object('estado', 'ok', 'dry_run', p_dry_run, 'hora_local', to_char(v_local, 'HH24:MI'),
                            'pendientes_antes', v_pend, 'creadas', v_creadas, 'detalle', v_acc);
end $function$;

-- ---------------------------------------------------------------- 6. pg_cron
-- El worker ('agent-worker'), 'interacciones-tick' y este planificador corren cada minuto.
select cron.schedule('planificador-tick', '* * * * *', 'select public.planificador_tick()');
