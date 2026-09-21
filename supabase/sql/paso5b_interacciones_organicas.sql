-- ByGether - Paso 5b: interacciones organicas SIN cuotas por tipo de destino (reemplaza las funciones del Paso 5).
-- Antes: 55 % de los follows iban a "no automaticas" y los likes/reposts daban x1.5 a autores no automaticos.
-- Ahora: un solo pool (cuentas automaticas + cuentas canal + usuarios reales) con los mismos pesos naturales para todos:
-- afinidad de tema, popularidad, actividad reciente, conexiones existentes y frescura del post.
-- Aplicado en Supabase como la migracion 'cuentas_automaticas_paso5b_interacciones_organicas'.

-- Temas de las cuentas canal (no son cuentas automaticas ni tienen config): solo sirven para calcular afinidad.
insert into public.agent_config (clave, valor, descripcion) values
  ('interacciones_temas_canal',
   '{"alexdeportes@worldigi.app":"deportes","athlemsport@worldigi.app":"deportes","cronussport@worldigi.app":"deportes","vibesee@worldigi.app":"actualidad"}'::jsonb,
   'Tema de cada cuenta canal (email en minusculas) para que las cuentas automaticas tengan afinidad natural con ellas')
on conflict (clave) do nothing;

-- Ya no existe una probabilidad fija de seguir a usuarios reales.
update public.agent_config
   set valor = valor - 'prob_seguir_real',
       descripcion = 'Limites de realismo: likes/reposts de cuentas automaticas por post, seguidores nuevos por dia, ventanas de antiguedad, etc. (sin cuotas por tipo de destino)',
       updated_at = now()
 where clave = 'interacciones_limites';

create or replace function public.interacciones_tema_de(p_email text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select pr.config_cuenta_automatica ->> 'tema_principal' from public.profiles pr where pr.user_email = p_email),
    public.agent_cfg('interacciones_temas_canal') ->> lower(p_email)
  )
$$;

-- FOLLOW: destino elegido entre TODAS las cuentas (menos la propia y las que ya sigue).
--   peso = (x4 si comparten tema) * (1 + ln(1 + seguidores)) * (x2 si publico en los ultimos 7 dias)
create or replace function public.interaccion_follow(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; t record; v_ts timestamptz;
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

  select pr.user_email, pr.user_name into t
    from public.profiles pr
   where pr.user_email <> a.user_email
     and not exists (select 1 from public.connections cn where cn.follower_email = a.user_email and cn.following_email = pr.user_email)
     and (select count(*) from public.connections cn where cn.following_email = pr.user_email and cn.created_at >= v_dia)
           < (v_lim ->> 'seguidores_nuevos_dia_por_destino')::int
   order by -ln(1 - random()) / (
            case when a.tema is not null and public.interacciones_tema_de(pr.user_email) = a.tema then 4.0 else 1.0 end
          * (1 + ln(1 + (select count(*) from public.connections cn where cn.following_email = pr.user_email)))
          * case when exists (select 1 from public.posts po where po.user_email = pr.user_email
                                 and po.created_at >= now() - interval '7 days') then 2.0 else 1.0 end)
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'follow', 'motivo', 'sin_destinos_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    insert into public.connections (follower_email, follower_name, following_email, following_name, created_at)
         values (a.user_email, a.user_name, t.user_email, t.user_name, v_ts)
    on conflict (follower_email, following_email) do nothing;
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'follow', 'cuenta', a.user_email, 'nivel', a.nivel, 'sigue_a', t.user_email);
end $function$;

-- LIKE: cualquier post (de cuenta automatica, cuenta canal o usuario real), sin sesgo por tipo de autor.
--   peso = frescura (decae con 18 h) * (x3 si ya sigue al autor) * (x2.5 si el autor comparte su tema)
create or replace function public.interaccion_like(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; p record; v_ts timestamptz;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select c.user_email, c.user_name, c.nivel, c.tema into a
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
            exp(-extract(epoch from now() - po.created_at) / 64800.0)
          * case when exists (select 1 from public.connections cn where cn.follower_email = a.user_email
                                 and cn.following_email = po.user_email) then 3.0 else 1.0 end
          * case when a.tema is not null and public.interacciones_tema_de(po.user_email) = a.tema then 2.5 else 1.0 end)
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'like', 'motivo', 'sin_posts_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    insert into public.post_likes (post_id, user_email, user_name, created_at) values (p.id, a.user_email, a.user_name, v_ts);
    update public.posts set likes = coalesce(likes, 0) + 1 where id = p.id;
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'like', 'cuenta', a.user_email, 'nivel', a.nivel, 'post_id', p.id, 'autor', p.autor);
end $function$;

-- REPOST: igual que like, con mas peso a los posts que ya tienen likes y frescura de 12 h.
create or replace function public.interaccion_repost(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tz  text  := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; p record; v_ts timestamptz;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  select c.user_email, c.user_name, c.nivel, c.tema into a
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
            exp(-extract(epoch from now() - po.created_at) / 43200.0)
          * (1 + ln(1 + coalesce(po.likes, 0)))
          * case when exists (select 1 from public.connections cn where cn.follower_email = a.user_email
                                 and cn.following_email = po.user_email) then 3.0 else 1.0 end
          * case when a.tema is not null and public.interacciones_tema_de(po.user_email) = a.tema then 2.5 else 1.0 end)
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', 'repost', 'motivo', 'sin_posts_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    insert into public.posts (user_email, user_name, content, image_url, likes, repost_of, quote_text, created_at)
         values (a.user_email, a.user_name, null, null, 0, p.id, null, v_ts);
  end if;
  return jsonb_build_object('hecho', true, 'tipo', 'repost', 'cuenta', a.user_email, 'nivel', a.nivel, 'post_id', p.id, 'autor', p.autor);
end $function$;
