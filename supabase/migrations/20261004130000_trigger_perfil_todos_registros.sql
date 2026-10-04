create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_avatar text;
begin
  -- Solo usuarios con correo confirmado; no tocar las cuentas simuladas
  if new.email is null
     or new.email_confirmed_at is null
     or new.email like '%@sim.bygether.invalid' then
    return new;
  end if;

  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1)
  );

  -- Foto: solo si viene del dominio de Google (los metadatos de un registro
  -- con correo los escribe el propio usuario y no son de fiar)
  v_avatar := nullif(trim(coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture', '')), '');
  if v_avatar is not null and v_avatar not like 'https://lh3.googleusercontent.com/%' then
    v_avatar := null;
  end if;
  if v_avatar is not null then
    v_avatar := regexp_replace(v_avatar, '=s\d+-c$', '=s256-c');
  end if;

  insert into public.profiles (user_email, user_name, avatar_url)
  values (new.email, v_nombre, v_avatar)
  on conflict (user_email) do nothing;

  return new;
exception when others then
  return new;  -- nunca bloquear el registro ni la confirmación por un fallo aquí
end;
$$;

drop trigger if exists on_auth_user_created_google_profile on auth.users;
drop function if exists public.crear_perfil_google();

drop trigger if exists on_auth_user_profile on auth.users;
create trigger on_auth_user_profile
after insert or update of email_confirmed_at on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();