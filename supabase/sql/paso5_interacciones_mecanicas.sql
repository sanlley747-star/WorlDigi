-- ByGether - PASO 5: interacciones mecanicas (likes, follows, reposts) de las cuentas automaticas.
-- 100 % SQL + pg_cron: costo $0, no toca la cola ni la cuota de Gemini.
-- Aplicado en Supabase como la migracion "cuentas_automaticas_paso5_interacciones".
--
-- Como decide (cada minuto, job 'interacciones-tick'):
--   1. Cuanto toca ahora: objetivo diario por tipo (interacciones_diarias) x peso de la hora (curva_horaria) menos lo ya hecho
--      esta hora, repartido en los minutos que quedan, con redondeo probabilistico (sin rafagas ni huecos).
--   2. Que cuenta actua: solo las que estan en su horario personal (config_cuenta_automatica.actividad.horas_activas),
--      con mas probabilidad las de nivel alta > media > baja y respetando sus topes diarios.
--   3. Sobre que: likes/reposts a posts recientes (mas recientes = mas probables; mas si sigue al autor; un poco mas si
--      el autor es un usuario real); follows a usuarios reales o a otras cuentas automaticas (preferencia por el mismo tema).
--   4. Escribe exactamente lo que escribe la app: post_likes + posts.likes+1, connections, y posts con repost_of.
--      Los triggers existentes generan las notificaciones.
-- Apagado por defecto: se enciende en el lanzamiento (Paso 7) con
--   update agent_config set valor = 'true' where clave = 'interacciones_activas';

-- ---------- configuracion ----------
insert into public.agent_config (clave, valor, descripcion) values
 ('interacciones_activas', 'false'::jsonb,
  'Interruptor de likes/follows/reposts automaticos (false hasta el lanzamiento)'),
 ('interacciones_diarias', '{"like":240,"follow":50,"repost":12}'::jsonb,
  'Objetivo de acciones por dia; se reparte por hora con curva_horaria y se autolimita si no hay posts/objetivos disponibles'),
 ('interacciones_niveles', '{"alta":{"peso":6,"likes_dia":20,"reposts_dia":3,"follows_dia":6,"siguiendo_max":45},
                             "media":{"peso":3,"likes_dia":10,"reposts_dia":2,"follows_dia":3,"siguiendo_max":25},
                             "baja":{"peso":1,"likes_dia":4,"reposts_dia":1,"follows_dia":2,"siguiendo_max":12}}'::jsonb,
  'Actividad relativa y topes diarios por cuenta segun su nivel (alta/media/baja)'),
 ('interacciones_limites', '{"likes_auto_por_post":12,"reposts_auto_por_post":3,"seguidores_nuevos_dia_por_destino":6,
                             "ventana_likes_horas":72,"ventana_repost_horas":48,"prob_seguir_real":0.55,"edad_min_post_seg":120,
                             "max_acciones_por_tipo_y_tick":4}'::jsonb,
  'Limites de realismo: likes/reposts de cuentas automaticas por post, seguidores nuevos por dia, ventanas de antiguedad, etc.')
on conflict (clave) do nothing;

-- indices que faltaban para las comprobaciones "ya dio like" / conteo por post (no cambian el comportamiento de la app)
create index if not exists post_likes_post_idx      on public.post_likes (post_id);
create index if not exists post_likes_user_post_idx on public.post_likes (user_email, post_id);

-- ---------- cuentas automaticas que estan en su horario ahora mismo ----------
create or replace function public.interacciones_cuentas_activas()
returns table (user_email text, user_name text, nivel text, tema text)
language sql stable security definer set search_path = public as $$
  select p.user_email, p.user_name,
         coalesce(p.config_cuenta_automatica -> 'actividad' ->> 'nivel', 'media'),
         p.config_cuenta_automatica ->> 'tema_principal'
    from public.profiles p
   where p.is_cuenta_automatica
     and extract(hour from now() at time zone coalesce(p.config_cuenta_automatica -> 'actividad' ->> 'zona_horaria',
                                                       public.agent_cfg('zona_horaria') #>> '{}'))
           >= coalesce((p.config_cuenta_automatica -> 'actividad' -> 'horas_activas' ->> 0)::int, 7)
     and extract(hour from now() at time zone coalesce(p.config_cuenta_automatica -> 'actividad' ->> 'zona_horaria',
                                                       public.agent_cfg('zona_horaria') #>> '{}'))
           <  coalesce((p.config_cuenta_automatica -> 'actividad' -> 'horas_activas' ->> 1)::int, 23)
$$;

-- ---------- LIKE ----------
create or replace function public.interaccion_like(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; p record; v_ts timestamptz;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select c.user_email, c.user_name, c.nivel into a
    from public.interacciones_cuentas_activas() c
    left join (select l.user_email, count(*) n from public.post_likes l where l.created_at >= v_dia group by 1) h
           on h.user_email = c.user_email
   where coalesce(h.n, 0) < (v_niv -> c.nivel ->> 'likes_dia')::int
   order by -ln(1 - random()) / (v_niv -> c.nivel ->> 'peso')::numeric
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'like', 'motivo', 'sin_cuentas_elegibles'); end if;

  select po.id, po.user_email as autor_email, po.user_name as autor into p
    from public.posts po
   where po.repost_of is null
     and po.user_email is distinct from a.user_email
     and po.created_at <= now() - make_interval(secs => (v_lim ->> 'edad_min_post_seg')::int)
     and po.created_at >= now() - make_interval(hours => (v_lim ->> 'ventana_likes_horas')::int)
     and not exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_email = a.user_email)
     and (select count(*) from public.post_likes l join public.profiles pr on pr.user_email = l.user_email and pr.is_cuenta_automatica
           where l.post_id = po.id) < (v_lim ->> 'likes_auto_por_post')::int
   order by -ln(1 - random()) / (
            exp(-extract(epoch from now() - po.created_at) / 64800.0)                                   -- mas reciente = mas probable (vida media ~12 h)
          * case when exists (select 1 from public.connections cn where cn.follower_email = a.user_email
                                 and cn.following_email = po.user_email) then 3.0 else 1.0 end          -- si sigue al autor
          * case when exists (select 1 from public.profiles pr where pr.user_email = po.user_email
                                 and pr.is_cuenta_automatica) then 1.0 else 1.5 end)                    -- usuarios reales, un poco mas
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'like', 'motivo', 'sin_posts_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';   -- no todas exactamente en el segundo :00 del cron
    insert into public.post_likes (post_id, user_email, user_name, created_at) values (p.id, a.user_email, a.user_name, v_ts);
    update public.posts set likes = coalesce(likes, 0) + 1 where id = p.id;
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'like', 'cuenta', a.user_email, 'nivel', a.nivel, 'post_id', p.id, 'autor', p.autor);
end $$;

-- ---------- FOLLOW ----------
create or replace function public.interaccion_follow(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; t record; v_real boolean; v_ok boolean := false; i integer; v_ts timestamptz;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select c.user_email, c.user_name, c.nivel, c.tema into a
    from public.interacciones_cuentas_activas() c
    left join (select cn.follower_email e, count(*) n from public.connections cn where cn.created_at >= v_dia group by 1) hoy on hoy.e = c.user_email
    left join (select cn.follower_email e, count(*) n from public.connections cn group by 1) tot on tot.e = c.user_email
   where coalesce(hoy.n, 0) < (v_niv -> c.nivel ->> 'follows_dia')::int
     and coalesce(tot.n, 0) < (v_niv -> c.nivel ->> 'siguiendo_max')::int
   order by -ln(1 - random()) / (v_niv -> c.nivel ->> 'peso')::numeric
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'follow', 'motivo', 'sin_cuentas_elegibles'); end if;

  v_real := random() < (v_lim ->> 'prob_seguir_real')::numeric;     -- primero el grupo preferido (real o automatico); si no hay, el otro
  for i in 1..2 loop
    select pr.user_email, pr.user_name into t
      from public.profiles pr
     where pr.user_email <> a.user_email
       and coalesce(pr.is_cuenta_automatica, false) = not v_real
       and not exists (select 1 from public.connections cn where cn.follower_email = a.user_email and cn.following_email = pr.user_email)
       and (select count(*) from public.connections cn where cn.following_email = pr.user_email and cn.created_at >= v_dia)
             < (v_lim ->> 'seguidores_nuevos_dia_por_destino')::int
     order by -ln(1 - random()) / (case when a.tema is not null and pr.config_cuenta_automatica ->> 'tema_principal' = a.tema
                                        then 4.0 else 1.0 end)                                             -- mismo tema = mas afinidad
     limit 1;
    if found then v_ok := true; exit; end if;
    v_real := not v_real;
  end loop;
  if not v_ok then return jsonb_build_object('hecho', false, 'tipo', 'follow', 'motivo', 'sin_destinos_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    insert into public.connections (follower_email, follower_name, following_email, following_name, created_at)
         values (a.user_email, a.user_name, t.user_email, t.user_name, v_ts)
    on conflict (follower_email, following_email) do nothing;
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'follow', 'cuenta', a.user_email, 'nivel', a.nivel, 'sigue_a', t.user_email);
end $$;

-- ---------- REPOST (compartir sin cita, igual que el boton de la app) ----------
create or replace function public.interaccion_repost(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; p record; v_ts timestamptz;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select c.user_email, c.user_name, c.nivel into a
    from public.interacciones_cuentas_activas() c
    left join (select r.user_email, count(*) n from public.posts r where r.repost_of is not null and r.created_at >= v_dia group by 1) h
           on h.user_email = c.user_email
   where coalesce(h.n, 0) < (v_niv -> c.nivel ->> 'reposts_dia')::int
   order by -ln(1 - random()) / (v_niv -> c.nivel ->> 'peso')::numeric
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'repost', 'motivo', 'sin_cuentas_elegibles'); end if;

  select po.id, po.user_email as autor_email, po.user_name as autor into p
    from public.posts po
   where po.repost_of is null
     and po.user_email is distinct from a.user_email
     and po.created_at <= now() - make_interval(secs => (v_lim ->> 'edad_min_post_seg')::int)
     and po.created_at >= now() - make_interval(hours => (v_lim ->> 'ventana_repost_horas')::int)
     and not exists (select 1 from public.posts r where r.user_email = a.user_email and r.repost_of = po.id)
     and (select count(*) from public.posts r join public.profiles pr on pr.user_email = r.user_email and pr.is_cuenta_automatica
           where r.repost_of = po.id) < (v_lim ->> 'reposts_auto_por_post')::int
   order by -ln(1 - random()) / (
            exp(-extract(epoch from now() - po.created_at) / 43200.0)                                   -- vida media ~8 h
          * (1 + ln(1 + coalesce(po.likes, 0)))                                                          -- lo que ya gusta se comparte mas
          * case when exists (select 1 from public.connections cn where cn.follower_email = a.user_email
                                 and cn.following_email = po.user_email) then 3.0 else 1.0 end
          * case when exists (select 1 from public.profiles pr where pr.user_email = po.user_email
                                 and pr.is_cuenta_automatica) then 1.0 else 1.5 end)
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'repost', 'motivo', 'sin_posts_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    insert into public.posts (user_email, user_name, content, image_url, likes, repost_of, quote_text, created_at)
         values (a.user_email, a.user_name, null, null, 0, p.id, null, v_ts);
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'repost', 'cuenta', a.user_email, 'nivel', a.nivel, 'post_id', p.id, 'autor', p.autor);
end $$;

-- ---------- orquestador de interacciones (lo llama pg_cron cada minuto) ----------
-- p_forzar: ignora interruptor, horario y cuota y hace 1 intento de cada tipo (para pruebas).  p_dry_run: elige pero no escribe.
create or replace function public.interacciones_tick(p_forzar boolean default false, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.agent_cfg('zona_horaria') #>> '{}';
  v_ini numeric := (public.agent_cfg('ventana_horaria') ->> 'inicio')::numeric;
  v_fin numeric := (public.agent_cfg('ventana_horaria') ->> 'fin')::numeric;
  v_curva jsonb := public.agent_cfg('curva_horaria');
  v_diarias jsonb := public.agent_cfg('interacciones_diarias');
  v_tope integer := (public.agent_cfg('interacciones_limites') ->> 'max_acciones_por_tipo_y_tick')::int;
  v_local timestamp := now() at time zone v_tz;
  v_h integer := extract(hour from v_local)::int;
  v_hdec numeric := extract(hour from v_local) + extract(minute from v_local) / 60.0;
  v_hora_ini timestamptz := date_trunc('hour', v_local) at time zone v_tz;
  v_peso numeric; v_suma numeric; v_quota numeric; v_usadas integer; v_esperado numeric; v_min_rest numeric;
  v_n integer; i integer; t text; r jsonb;
  v_acc jsonb := '[]'::jsonb; v_hechas jsonb := jsonb_build_object('like', 0, 'follow', 0, 'repost', 0);
begin
  if not p_forzar then
    if not coalesce((public.agent_cfg('interacciones_activas'))::text::boolean, false) then
      return jsonb_build_object('estado', 'desactivado');
    end if;
    if not pg_try_advisory_xact_lock(hashtext('interacciones_tick')) then return jsonb_build_object('estado', 'ocupado'); end if;
    if v_hdec < v_ini or v_hdec >= v_fin then return jsonb_build_object('estado', 'fuera_de_horario', 'hora_local', to_char(v_local, 'HH24:MI')); end if;
  end if;

  select coalesce(sum(value::numeric), 0) into v_suma from jsonb_each_text(v_curva) where key::numeric >= floor(v_ini) and key::numeric < v_fin;
  v_peso := coalesce((v_curva ->> v_h::text)::numeric, 0);

  foreach t in array array['like', 'follow', 'repost'] loop
    if p_forzar then
      v_n := 1;
    else
      if t = 'like' then
        select count(*) into v_usadas from public.post_likes l join public.profiles p on p.user_email = l.user_email and p.is_cuenta_automatica
         where l.created_at >= v_hora_ini;
      elsif t = 'follow' then
        select count(*) into v_usadas from public.connections c join public.profiles p on p.user_email = c.follower_email and p.is_cuenta_automatica
         where c.created_at >= v_hora_ini;
      else
        select count(*) into v_usadas from public.posts r join public.profiles p on p.user_email = r.user_email and p.is_cuenta_automatica
         where r.repost_of is not null and r.created_at >= v_hora_ini;
      end if;
      v_quota    := coalesce((v_diarias ->> t)::numeric, 0) * v_peso / nullif(v_suma, 0);
      v_min_rest := greatest((least(v_h + 1, v_fin) - v_hdec) * 60, 1);
      v_esperado := greatest(coalesce(v_quota, 0) - v_usadas, 0) / v_min_rest;
      v_n := least(floor(v_esperado)::int + case when random() < v_esperado - floor(v_esperado) then 1 else 0 end, v_tope);
    end if;

    for i in 1..v_n loop
      r := case t when 'like' then public.interaccion_like(p_dry_run)
                  when 'follow' then public.interaccion_follow(p_dry_run)
                  else public.interaccion_repost(p_dry_run) end;
      v_acc := v_acc || r;
      if (r ->> 'hecho')::boolean then v_hechas := jsonb_set(v_hechas, array[t], to_jsonb((v_hechas ->> t)::int + 1)); end if;
      exit when not (r ->> 'hecho')::boolean;     -- sin candidatos: no insistir en este minuto
    end loop;
  end loop;

  return jsonb_build_object('estado', 'ok', 'hora_local', to_char(v_local, 'HH24:MI'), 'hechas', v_hechas, 'detalle', v_acc);
end $$;

-- ---------- resumen para diagnostico ----------
create or replace function public.interacciones_resumen()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
begin
  return jsonb_build_object(
    'activas', public.agent_cfg('interacciones_activas'),
    'cuentas_en_horario_ahora', (select count(*) from public.interacciones_cuentas_activas()),
    'hoy', jsonb_build_object(
      'likes',   (select count(*) from public.post_likes l join public.profiles p on p.user_email = l.user_email and p.is_cuenta_automatica where l.created_at >= v_dia),
      'follows', (select count(*) from public.connections c join public.profiles p on p.user_email = c.follower_email and p.is_cuenta_automatica where c.created_at >= v_dia),
      'reposts', (select count(*) from public.posts r join public.profiles p on p.user_email = r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.created_at >= v_dia)),
    'total', jsonb_build_object(
      'likes',   (select count(*) from public.post_likes l join public.profiles p on p.user_email = l.user_email and p.is_cuenta_automatica),
      'follows', (select count(*) from public.connections c join public.profiles p on p.user_email = c.follower_email and p.is_cuenta_automatica),
      'reposts', (select count(*) from public.posts r join public.profiles p on p.user_email = r.user_email and p.is_cuenta_automatica where r.repost_of is not null)));
end $$;

-- ---------- la purga (--purge) ahora tambien corrige el contador posts.likes de los posts reales ----------
create or replace function public.purgar_cuentas_automaticas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emails text[]; v_posts bigint[]; v_comms bigint[]; r jsonb := '{}'::jsonb; n integer;
begin
  select coalesce(array_agg(user_email), '{}') into v_emails from public.profiles where is_cuenta_automatica;
  if coalesce(array_length(v_emails, 1), 0) = 0 then return jsonb_build_object('cuentas', 0); end if;

  select coalesce(array_agg(id), '{}') into v_posts from public.posts where user_email = any(v_emails);
  select coalesce(array_agg(id), '{}') into v_comms from public.comments where user_email = any(v_emails) or post_id = any(v_posts);

  delete from public.notifications
   where actor_email = any(v_emails) or recipient_email = any(v_emails) or post_id = any(v_posts) or comment_id = any(v_comms);
  get diagnostics n = row_count; r := r || jsonb_build_object('notificaciones', n);

  -- los likes de cuentas automaticas a posts que se quedan: descontarlos del contador que muestra la app
  update public.posts p set likes = greatest(coalesce(p.likes, 0) - c.n, 0)
    from (select l.post_id, count(*)::int n from public.post_likes l
           where l.user_email = any(v_emails) and not (l.post_id = any(v_posts)) group by l.post_id) c
   where p.id = c.post_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('contadores_likes_corregidos', n);

  delete from public.post_likes where user_email = any(v_emails) or post_id = any(v_posts);
  get diagnostics n = row_count; r := r || jsonb_build_object('likes', n);

  delete from public.comments where id = any(v_comms);
  get diagnostics n = row_count; r := r || jsonb_build_object('comentarios', n);

  delete from public.connections where follower_email = any(v_emails) or following_email = any(v_emails);
  get diagnostics n = row_count; r := r || jsonb_build_object('conexiones', n);

  delete from public.posts where repost_of = any(v_posts) and not (id = any(v_posts));
  delete from public.posts where id = any(v_posts);
  get diagnostics n = row_count; r := r || jsonb_build_object('posts', n);

  delete from public.profiles where is_cuenta_automatica;   -- agent_queue cae por cascade
  get diagnostics n = row_count; r := r || jsonb_build_object('cuentas', n);
  return r;
end $$;

-- ---------- permisos: solo service_role / pg_cron ----------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('interacciones_cuentas_activas','interaccion_like','interaccion_follow','interaccion_repost',
                                'interacciones_tick','interacciones_resumen','purgar_cuentas_automaticas')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to service_role', r.f);
  end loop;
end $$;

-- ---------- programacion: cada minuto (no hace nada mientras interacciones_activas = false) ----------
select cron.schedule('interacciones-tick', '* * * * *', $cron$ select public.interacciones_tick() $cron$);
