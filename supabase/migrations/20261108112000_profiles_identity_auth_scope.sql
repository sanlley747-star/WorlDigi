-- Keep profile identity resolution limited to profiles and Auth; channel/automatic profiles have no Auth identity.
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
  if new.auth_user_id is null and coalesce(new.is_cuenta_automatica,false)=false then
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
revoke all on function public.profiles_prepare_identity() from public,anon,authenticated,service_role;
