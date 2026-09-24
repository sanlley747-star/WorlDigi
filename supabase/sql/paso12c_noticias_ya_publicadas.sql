-- ByGether - PASO 12 / bloque 3: dado un arreglo de URLs normalizadas, devuelve las que ya fueron publicadas
-- (por las cuentas-persona en noticias_usadas, o por cualquier cuenta en los ultimos 30 dias dentro de posts).
create or replace function public.noticias_ya_publicadas(p_urls text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u), '{}'::text[])
  from unnest(p_urls) as u
  where exists (select 1 from public.noticias_usadas n where n.url_normalizada = u)
     or exists (
       select 1 from public.posts p
       where p.created_at > now() - interval '30 days'
         and (p.metadata->>'url' = u or position(u in coalesce(p.content, '')) > 0)
     );
$$;
revoke execute on function public.noticias_ya_publicadas(text[]) from public, anon, authenticated;
grant execute on function public.noticias_ya_publicadas(text[]) to service_role;
