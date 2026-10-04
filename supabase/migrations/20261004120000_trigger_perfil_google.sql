create or replace function public.crear_perfil_google()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider','') = 'google'
     and new.email is not null then
    insert into public.profiles (user_email, user_name)
    values (
      new.email,
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'name'), ''),
        split_part(new.email, '@', 1)
      )
    )
    on conflict (user_email) do nothing;
  end if;
  return new;
exception when others then
  return new;  -- nunca bloquear el registro por un fallo al crear el perfil
end;
$$;

drop trigger if exists on_auth_user_created_google_profile on auth.users;
create trigger on_auth_user_created_google_profile
after insert on auth.users
for each row execute function public.crear_perfil_google();