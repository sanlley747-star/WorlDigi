insert into public.profiles (user_email, user_name)
select
  u.email,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    split_part(u.email, '@', 1)
  )
from auth.users u
where u.email is not null
  and u.email not like '%@sim.bygether.invalid'
  and not exists (
    select 1 from public.profiles p where lower(p.user_email) = lower(u.email)
  )
on conflict (user_email) do nothing;