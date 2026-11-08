-- Bloque 3B: aislamiento de connections y funciones públicas sin correos.

create or replace function public.connections_counts_by_username(p_user_name text)
returns table (following bigint, followers bigint)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text;
  v_is_channel boolean;
begin
  if nullif(btrim(p_user_name), '') is null then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  select p.user_email,
         exists (
           select 1 from public.cuentas_canal cc
           where lower(cc.user_email) = lower(p.user_email)
         )
    into v_email, v_is_channel
    from public.profiles p
   where p.user_name = p_user_name
   limit 1;

  if v_email is null then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    case
      when coalesce(v_is_channel, false)
       and lower(coalesce(auth.email(), '')) <> lower(v_email)
      then 0::bigint
      else (select count(*) from public.connections c where c.follower_email = v_email)
    end,
    (select count(*) from public.connections c where c.following_email = v_email);
end;
$function$;

create or replace function public.connections_followers_by_username(
  p_user_name text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (user_name text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text;
begin
  if nullif(btrim(p_user_name), '') is null then
    return;
  end if;

  select p.user_email into v_email
    from public.profiles p
   where p.user_name = p_user_name
   limit 1;

  if v_email is null then
    return;
  end if;

  return query
  select p.user_name, p.avatar_url
    from public.connections c
    join public.profiles p
      on lower(p.user_email) = lower(c.follower_email)
   where c.following_email = v_email
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.connections_following_by_username(
  p_user_name text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (user_name text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text;
  v_is_channel boolean;
begin
  if nullif(btrim(p_user_name), '') is null then
    return;
  end if;

  select p.user_email,
         exists (
           select 1 from public.cuentas_canal cc
           where lower(cc.user_email) = lower(p.user_email)
         )
    into v_email, v_is_channel
    from public.profiles p
   where p.user_name = p_user_name
   limit 1;

  if v_email is null then
    return;
  end if;

  -- Se conserva la privacidad existente: el "siguiendo" de cuentas canal
  -- solo es visible para la propia cuenta.
  if coalesce(v_is_channel, false)
     and lower(coalesce(auth.email(), '')) <> lower(v_email) then
    return;
  end if;

  return query
  select p.user_name, p.avatar_url
    from public.connections c
    join public.profiles p
      on lower(p.user_email) = lower(c.following_email)
   where c.follower_email = v_email
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

revoke execute on function public.connections_counts_by_username(text) from public, anon, authenticated;
revoke execute on function public.connections_followers_by_username(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.connections_following_by_username(text, integer, integer) from public, anon, authenticated;
grant execute on function public.connections_counts_by_username(text) to anon, authenticated;
grant execute on function public.connections_followers_by_username(text, integer, integer) to anon, authenticated;
grant execute on function public.connections_following_by_username(text, integer, integer) to anon, authenticated;

revoke select on table public.connections from anon;
grant select on table public.connections to authenticated;

drop policy if exists connections_select_visible on public.connections;
create policy connections_select_visible
on public.connections
for select
to authenticated
using (
  follower_email = (select auth.email())
  or following_email = (select auth.email())
);

-- connections_insert_own y connections_delete_own ya validan auth.email();
-- se conservan sin cambios.