-- Bloque 5: citas IA manteniendo action_type=REPOST.
-- La cita se distingue por payload.con_cita=true mientras esta en cola
-- y por posts.quote_text no nulo una vez publicada.

create or replace function public.interaccion_repost(p_dry boolean default false, p_cita boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz text := public.agent_cfg('zona_horaria') #>> '{}';
  v_dia timestamptz;
  v_niv jsonb := public.agent_cfg('interacciones_niveles');
  v_lim jsonb := public.agent_cfg('interacciones_limites');
  a record; p record; v_ts timestamptz;
  v_tipo text := case when p_cita then 'cita' else 'repost' end;
  v_clave_nivel text := case when p_cita then 'citas_dia' else 'reposts_dia' end;
begin
  v_dia := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  select c.user_email, c.user_name, c.nivel, c.tema into a
    from public.interacciones_cuentas_activas() c
   where (
     select count(*) from public.posts r
      where r.user_email = c.user_email and r.repost_of is not null and r.created_at >= v_dia
        and (case when p_cita then r.quote_text is not null else r.quote_text is null end)
   ) + case when p_cita then (
     select count(*) from public.agent_queue q
      where q.agent_id = c.user_email and q.action_type = 'REPOST'
        and q.status in ('pending','processing')
        and coalesce((q.payload ->> 'con_cita')::boolean, false)
        and q.created_at >= v_dia
   ) else 0 end
   < coalesce((v_niv -> c.nivel ->> v_clave_nivel)::int, 0)
   order by -ln(1 - random()) / (v_niv -> c.nivel ->> 'peso')::numeric
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', v_tipo, 'motivo', 'sin_cuentas_elegibles'); end if;

  select po.id, po.user_email as autor_email, po.user_name as autor into p
    from public.posts po
   where po.repost_of is null and po.user_email is distinct from a.user_email
     and po.created_at <= now() - make_interval(secs => (v_lim ->> 'edad_min_post_seg')::int)
     and po.created_at >= now() - make_interval(hours => (v_lim ->> 'ventana_repost_horas')::int)
     and not exists (select 1 from public.posts r where r.user_email = a.user_email and r.repost_of = po.id)
     and (select count(*) from public.posts r join public.profiles pr on pr.user_email = r.user_email and pr.is_cuenta_automatica where r.repost_of = po.id)
         < (v_lim ->> 'reposts_auto_por_post')::int
   order by -ln(1 - random()) / (
      exp(-extract(epoch from now() - po.created_at) / 43200.0)
      * (1 + ln(1 + coalesce(po.likes, 0)))
      * case when exists (select 1 from public.connections cn where cn.follower_email=a.user_email and cn.following_email=po.user_email) then 3.0 else 1.0 end
      * case when a.tema is not null and public.interacciones_tema_de(po.user_email)=a.tema then 2.5 else 1.0 end)
   limit 1;
  if not found then return jsonb_build_object('hecho', false, 'tipo', v_tipo, 'motivo', 'sin_posts_elegibles', 'cuenta', a.user_email); end if;

  if not p_dry then
    v_ts := now() - random() * interval '50 seconds';
    if p_cita then
      insert into public.agent_queue (agent_id, action_type, target_id, priority, scheduled_at, payload)
      values (a.user_email, 'REPOST', p.id::text, 2, v_ts, jsonb_build_object('con_cita', true, 'origen', 'interacciones'));
    else
      insert into public.posts (user_email,user_name,content,image_url,likes,repost_of,quote_text,created_at)
      values (a.user_email,a.user_name,null,null,0,p.id,null,v_ts);
    end if;
  end if;

  return jsonb_build_object('hecho',true,'tipo',v_tipo,'cuenta',a.user_email,'nivel',a.nivel,'post_id',p.id,'autor',p.autor,
    'encolada',case when p_cita and not p_dry then true else false end);
end
$function$;

create or replace function public.worker_completar_cita(p_task_id bigint,p_post_id bigint,p_agent_email text,p_quote_text text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_id bigint; v_quote text := btrim(coalesce(p_quote_text,''));
begin
  perform 1 from public.agent_queue
   where id=p_task_id and status='processing' and agent_id=p_agent_email and action_type='REPOST'
     and coalesce((payload ->> 'con_cita')::boolean,false) for update;
  if not found then raise exception 'la tarea % no esta en processing para % o no es una cita',p_task_id,p_agent_email; end if;
  select user_name into v_name from public.profiles where user_email=p_agent_email and is_cuenta_automatica;
  if v_name is null then raise exception 'cuenta automatica inexistente: %',p_agent_email; end if;
  if v_quote='' or length(v_quote)>1000 then raise exception 'cita invalida'; end if;
  if not exists (select 1 from public.posts where id=p_post_id) then raise exception 'post inexistente: %',p_post_id; end if;
  if exists (select 1 from public.posts where user_email=p_agent_email and repost_of=p_post_id) then raise exception 'ya existe un repost/cita de % para %',p_post_id,p_agent_email; end if;

  insert into public.posts (user_email,user_name,content,image_url,likes,repost_of,quote_text,created_at,metadata)
  values (p_agent_email,v_name,null,null,0,p_post_id,v_quote,now(),jsonb_build_object('tipo','cita_ia','origen','interacciones'));

  update public.agent_queue set status='completed',completed_at=now(),last_error=null where id=p_task_id;

  select id into v_id from public.posts where user_email=p_agent_email and repost_of=p_post_id and quote_text=v_quote order by id desc limit 1;
  return v_id;
end
$function$;

create or replace function public.interacciones_tick(p_forzar boolean default false,p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz text := public.agent_cfg('zona_horaria') #>> '{}';
  v_ini numeric := (public.agent_cfg('ventana_horaria')->>'inicio')::numeric;
  v_fin numeric := (public.agent_cfg('ventana_horaria')->>'fin')::numeric;
  v_curva jsonb := public.agent_cfg('curva_horaria');
  v_diarias jsonb := public.agent_cfg('interacciones_diarias');
  v_tope integer := (public.agent_cfg('interacciones_limites')->>'max_acciones_por_tipo_y_tick')::int;
  v_prob_cita numeric := coalesce((public.agent_cfg('interacciones_limites')->>'prob_cita')::numeric,0.60);
  v_local timestamp := now() at time zone v_tz;
  v_h integer := extract(hour from v_local)::int;
  v_hdec numeric := extract(hour from v_local)+extract(minute from v_local)/60.0;
  v_hora_ini timestamptz := date_trunc('hour',v_local) at time zone v_tz;
  v_peso numeric; v_suma numeric; v_quota numeric; v_usadas integer; v_esperado numeric; v_min_rest numeric;
  v_n integer; i integer; t text; r jsonb;
  v_acc jsonb := '[]'::jsonb;
  v_hechas jsonb := jsonb_build_object('like',0,'follow',0,'repost',0,'cita',0);
begin
  if not p_forzar then
    if not coalesce((public.agent_cfg('interacciones_activas'))::text::boolean,false) then return jsonb_build_object('estado','desactivado'); end if;
    if not pg_try_advisory_xact_lock(hashtext('interacciones_tick')) then return jsonb_build_object('estado','ocupado'); end if;
    if v_hdec < v_ini or v_hdec >= v_fin then return jsonb_build_object('estado','fuera_de_horario','hora_local',to_char(v_local,'HH24:MI')); end if;
  end if;
  select coalesce(sum(value::numeric),0) into v_suma from jsonb_each_text(v_curva)
   where key::numeric >= floor(v_ini) and key::numeric < v_fin;
  v_peso := coalesce((v_curva->>v_h::text)::numeric,0);

  foreach t in array array['like','follow','repost','cita'] loop
    if t='cita' and not p_forzar and random() >= v_prob_cita then
      v_n := 0;
    elsif p_forzar then
      v_n := 1;
    else
      if t='like' then
        select count(*) into v_usadas from public.post_likes l join public.profiles p on p.user_email=l.user_email and p.is_cuenta_automatica where l.created_at>=v_hora_ini;
      elsif t='follow' then
        select count(*) into v_usadas from public.connections c join public.profiles p on p.user_email=c.follower_email and p.is_cuenta_automatica where c.created_at>=v_hora_ini;
      elsif t='repost' then
        select count(*) into v_usadas from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is null and r.created_at>=v_hora_ini;
      else
        select count(*) into v_usadas from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is not null and r.created_at>=v_hora_ini;
        v_usadas := v_usadas + (select count(*) from public.agent_queue q where q.action_type='REPOST' and q.status in ('pending','processing') and coalesce((q.payload->>'con_cita')::boolean,false) and q.created_at>=v_hora_ini);
      end if;
      v_quota := coalesce((v_diarias->>t)::numeric,0)*v_peso/nullif(v_suma,0);
      v_min_rest := greatest((least(v_h+1,v_fin)-v_hdec)*60,1);
      v_esperado := greatest(coalesce(v_quota,0)-v_usadas,0)/v_min_rest;
      v_n := least(floor(v_esperado)::int+case when random()<v_esperado-floor(v_esperado) then 1 else 0 end,v_tope);
    end if;

    for i in 1..v_n loop
      r := case t when 'like' then public.interaccion_like(p_dry_run)
                  when 'follow' then public.interaccion_follow(p_dry_run)
                  when 'repost' then public.interaccion_repost(p_dry_run,false)
                  else public.interaccion_repost(p_dry_run,true) end;
      v_acc := v_acc || r;
      if coalesce((r->>'hecho')::boolean,false) then v_hechas := jsonb_set(v_hechas,array[t],to_jsonb((v_hechas->>t)::int+1)); end if;
      exit when not coalesce((r->>'hecho')::boolean,false);
    end loop;
  end loop;

  return jsonb_build_object('estado','ok','hora_local',to_char(v_local,'HH24:MI'),'hechas',v_hechas,'detalle',v_acc);
end
$function$;

create or replace function public.interacciones_resumen()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tz text := public.agent_cfg('zona_horaria') #>> '{}'; v_dia timestamptz := date_trunc('day',now() at time zone v_tz) at time zone v_tz;
begin
  return jsonb_build_object(
    'activas',public.agent_cfg('interacciones_activas'),
    'cuentas_en_horario_ahora',(select count(*) from public.interacciones_cuentas_activas()),
    'hoy',jsonb_build_object(
      'likes',(select count(*) from public.post_likes l join public.profiles p on p.user_email=l.user_email and p.is_cuenta_automatica where l.created_at>=v_dia),
      'follows',(select count(*) from public.connections c join public.profiles p on p.user_email=c.follower_email and p.is_cuenta_automatica where c.created_at>=v_dia),
      'reposts',(select count(*) from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is null and r.created_at>=v_dia),
      'citas',(select count(*) from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is not null and r.created_at>=v_dia)),
    'total',jsonb_build_object(
      'likes',(select count(*) from public.post_likes l join public.profiles p on p.user_email=l.user_email and p.is_cuenta_automatica),
      'follows',(select count(*) from public.connections c join public.profiles p on p.user_email=c.follower_email and p.is_cuenta_automatica),
      'reposts',(select count(*) from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is null),
      'citas',(select count(*) from public.posts r join public.profiles p on p.user_email=r.user_email and p.is_cuenta_automatica where r.repost_of is not null and r.quote_text is not null)));
end
$function$;

update public.agent_config
set valor=jsonb_set(jsonb_set(coalesce(valor,'{}'::jsonb),'{cita}','18'::jsonb,true),'{repost}','12'::jsonb,true)
where clave='interacciones_diarias';

update public.agent_config
set valor=jsonb_set(jsonb_set(jsonb_set(coalesce(valor,'{}'::jsonb),'{alta,citas_dia}','4'::jsonb,true),'{media,citas_dia}','2'::jsonb,true),'{baja,citas_dia}','1'::jsonb,true)
where clave='interacciones_niveles';

update public.agent_config
set valor=jsonb_set(coalesce(valor,'{}'::jsonb),'{prob_cita}','0.60'::jsonb,true)
where clave='interacciones_limites';
