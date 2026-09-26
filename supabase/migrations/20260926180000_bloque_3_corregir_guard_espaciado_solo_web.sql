-- Bloque 3: el espaciado mínimo solo aplica a publicaciones automáticas provenientes del circuito web/noticias.
-- Reposts y demás actividades de interacción/script quedan independientes.

create or replace function public.guard_espaciado_posts_automaticos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_min_horas integer;
  v_ultimo_web timestamptz;
begin
  if new.repost_of is not null then
    return new;
  end if;

  if not (
    coalesce(new.metadata->>'tipo','') = 'link_preview'
    or nullif(btrim(new.metadata->>'url'),'') is not null
    or (
      coalesce(new.metadata->>'tipo','') = 'noticia'
      and coalesce(new.metadata->>'origen','') = 'agent-noticias'
    )
  ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.is_cuenta_automatica
      and lower(pr.user_email) = lower(new.user_email)
  ) then
    return new;
  end if;

  v_min_horas := coalesce(
    (public.agent_cfg('planificador_limites') ->> 'min_horas_entre_posts')::integer,
    8
  );

  perform pg_advisory_xact_lock(
    hashtextextended('bygether:auto-web-post:' || lower(new.user_email), 0)
  );

  select max(p.created_at)
    into v_ultimo_web
  from public.posts p
  where lower(p.user_email) = lower(new.user_email)
    and p.repost_of is null
    and (
      coalesce(p.metadata->>'tipo','') = 'link_preview'
      or nullif(btrim(p.metadata->>'url'),'') is not null
      or (
        coalesce(p.metadata->>'tipo','') = 'noticia'
        and coalesce(p.metadata->>'origen','') = 'agent-noticias'
      )
    );

  if v_ultimo_web is not null
     and new.created_at < v_ultimo_web + make_interval(hours => v_min_horas)
  then
    raise exception
      'AUTO_WEB_POST_SPACING: cuenta % no puede publicar fuente web antes de %; ultima publicación web %, minimo % horas',
      new.user_email,
      v_ultimo_web + make_interval(hours => v_min_horas),
      v_ultimo_web,
      v_min_horas
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;
