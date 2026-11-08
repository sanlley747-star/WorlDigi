-- TuNetFy Bloque 3C: UUID interno, auth UUID opcional y @ público único.
begin;

alter table public.profiles
  add column if not exists profile_id uuid default gen_random_uuid(),
  add column if not exists auth_user_id uuid,
  add column if not exists username text;

update public.profiles set profile_id = gen_random_uuid() where profile_id is null;

do $$
declare r record; v_base text; v_candidate text; v_n integer; v_numbered integer := 0;
begin
  for r in select user_email,user_name from public.profiles order by lower(user_email) loop
    if not exists(select 1 from public.profiles p where p.user_email=r.user_email and p.username is not null) then
      v_base := lower(coalesce(r.user_name,'usuario'));
      v_base := translate(v_base,'áàäâãåéèëêíìïîóòöôõúùüûñç','aaaaaaeeeeiiiiooooouuuunc');
      v_base := trim(both '_' from regexp_replace(v_base,'[^a-z0-9]+','_','g'));
      v_base := left(v_base,20);
      if length(v_base)<3 then v_base := 'usuario'; end if;
      v_candidate := v_base; v_n := 1;
      while lower(v_candidate) in ('admin','administrator','tunetfy','soporte','support','help','ayuda','root','system','moderador','moderator','null','undefined','api','security','staff','team','official','webmaster','owner','postmaster','abuse','contact','info')
        or exists(select 1 from public.profiles p where lower(p.username)=lower(v_candidate)) loop
        v_n := v_n+1;
        v_candidate := left(v_base,20-length(v_n::text)) || v_n::text;
      end loop;
      if v_n>1 then v_numbered := v_numbered+1; end if;
      update public.profiles set username=v_candidate where user_email=r.user_email;
    end if;
  end loop;
  raise notice 'usernames_suffix_numbered=%',v_numbered;
end $$;

update public.profiles p
set auth_user_id=u.id
from auth.users u
where lower(u.email)=lower(p.user_email)
  and p.auth_user_id is null
  and coalesce(p.is_cuenta_automatica,false)=false
  and not exists(select 1 from public.cuentas_canal c where lower(c.user_email)=lower(p.user_email));

alter table public.profiles
  alter column profile_id set default gen_random_uuid(),
  alter column profile_id set not null,
  alter column username set not null;

create unique index if not exists profiles_profile_id_uidx on public.profiles(profile_id);
create unique index if not exists profiles_username_lower_uidx on public.profiles(lower(username));
create unique index if not exists profiles_auth_user_id_uidx on public.profiles(auth_user_id) where auth_user_id is not null;

create or replace function public.username_disponible(p_username text)
returns boolean language sql stable security invoker set search_path=public
as $$
  select coalesce(
    p_username ~ '^[a-z0-9_]{3,20}$'
    and lower(p_username) not in ('admin','administrator','tunetfy','soporte','support','help','ayuda','root','system','moderador','moderator','null','undefined','api','security','staff','team','official','webmaster','owner','postmaster','abuse','contact','info')
    and not exists(select 1 from public.profiles p where lower(p.username)=lower(p_username)),
    false
  );
$$;
revoke all on function public.username_disponible(text) from public;
grant execute on function public.username_disponible(text) to anon,authenticated;

create or replace function public.profiles_prepare_identity()
returns trigger language plpgsql security definer set search_path=public,auth
as $$
declare v_meta_username text; v_base text; v_candidate text; v_n integer;
begin
  if tg_op='UPDATE' then
    if new.profile_id is distinct from old.profile_id then raise exception 'profile_id is immutable'; end if;
    if new.auth_user_id is distinct from old.auth_user_id then raise exception 'auth_user_id is immutable'; end if;
    if new.username is distinct from old.username then
      if auth.uid() is null or old.user_email is distinct from auth.email() then raise exception 'username can only be changed by its owner'; end if;
      if new.username !~ '^[a-z0-9_]{3,20}$' or lower(new.username) in ('admin','administrator','tunetfy','soporte','support','help','ayuda','root','system','moderador','moderator','null','undefined','api','security','staff','team','official','webmaster','owner','postmaster','abuse','contact','info') then
        raise exception 'invalid or reserved username';
      end if;
    end if;
    return new;
  end if;

  if new.profile_id is null then new.profile_id:=gen_random_uuid(); end if;
  if new.auth_user_id is null and coalesce(new.is_cuenta_automatica,false)=false
    and not exists(select 1 from public.cuentas_canal c where lower(c.user_email)=lower(new.user_email)) then
    select u.id,u.raw_user_meta_data->>'username' into new.auth_user_id,v_meta_username
    from auth.users u where lower(u.email)=lower(new.user_email) limit 1;
    if new.username is null then new.username:=v_meta_username; end if;
  end if;

  if new.username is null or btrim(new.username)='' then
    v_base:=lower(coalesce(new.user_name,'usuario'));
    v_base:=translate(v_base,'áàäâãåéèëêíìïîóòöôõúùüûñç','aaaaaaeeeeiiiiooooouuuunc');
    v_base:=trim(both '_' from regexp_replace(v_base,'[^a-z0-9]+','_','g'));
    v_base:=left(v_base,20);
    if length(v_base)<3 then v_base:='usuario'; end if;
    v_candidate:=v_base; v_n:=1;
    while lower(v_candidate) in ('admin','administrator','tunetfy','soporte','support','help','ayuda','root','system','moderador','moderator','null','undefined','api','security','staff','team','official','webmaster','owner','postmaster','abuse','contact','info')
      or exists(select 1 from public.profiles p where lower(p.username)=lower(v_candidate)) loop
      v_n:=v_n+1; v_candidate:=left(v_base,20-length(v_n::text))||v_n::text;
    end loop;
    new.username:=v_candidate;
  end if;
  if new.username !~ '^[a-z0-9_]{3,20}$' or lower(new.username) in ('admin','administrator','tunetfy','soporte','support','help','ayuda','root','system','moderador','moderator','null','undefined','api','security','staff','team','official','webmaster','owner','postmaster','abuse','contact','info') then
    raise exception 'invalid or reserved username';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prepare_identity on public.profiles;
create trigger profiles_prepare_identity before insert or update on public.profiles
for each row execute function public.profiles_prepare_identity();

-- Preservar el SELECT efectivo de authenticated sobre columnas existentes, excluyendo solo los UUID privados.
revoke select on public.profiles from authenticated;
grant select(user_email,user_name,avatar_url,cover_url,updated_at,is_cuenta_automatica,persona_id,config_cuenta_automatica,username)
  on public.profiles to authenticated;
grant select(user_name,avatar_url,cover_url,updated_at,username) on public.profiles to anon;
revoke select(profile_id,auth_user_id) on public.profiles from anon,authenticated;
grant update(username) on public.profiles to authenticated;
revoke update(username) on public.profiles from anon;
grant insert(username) on public.profiles to service_role;
grant update(username) on public.profiles to service_role;
revoke select(profile_id,auth_user_id) on public.profiles from service_role;

commit;
