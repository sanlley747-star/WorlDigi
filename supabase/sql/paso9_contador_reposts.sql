-- Paso 9 - Contador de reposts por publicacion (ByGether)
--
-- Funcion de SOLO LECTURA: cuantas publicaciones (reposts y citas) apuntan a cada publicacion de una lista.
--  * No modifica ninguna tabla ni columna existente.
--  * SECURITY INVOKER: respeta el RLS de public.posts como el resto de consultas del front.
--  * Cuenta en vivo (siempre coincide con la realidad, incluidas las purgas y "Deshacer").

create or replace function public.repost_counts(post_ids bigint[])
returns table (post_id bigint, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select p.repost_of as post_id, count(*)::bigint as total
  from public.posts p
  where p.repost_of = any(post_ids)
  group by p.repost_of;
$$;

grant execute on function public.repost_counts(bigint[]) to anon, authenticated;
