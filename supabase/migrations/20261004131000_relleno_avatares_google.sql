update public.profiles p
set avatar_url = regexp_replace(
      coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
      '=s\d+-c$', '=s256-c'),
    updated_at = now()
from auth.users u
where lower(u.email) = lower(p.user_email)
  and p.avatar_url is null
  and p.is_cuenta_automatica = false
  and coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
      like 'https://lh3.googleusercontent.com/%';