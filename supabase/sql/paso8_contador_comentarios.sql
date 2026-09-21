-- Paso 8 - Contador de comentarios por publicacion (ByGether)
--
-- Funcion de SOLO LECTURA que devuelve cuantos comentarios tiene cada publicacion de una lista.
--  * No modifica ninguna tabla ni columna existente (aislado).
--  * SECURITY INVOKER: respeta el RLS de public.comments igual que el resto de consultas del front.
--  * Cuenta en vivo, asi que siempre coincide con la realidad (purgas, borrados, cuentas automaticas...).
--  * Evita el tope de 1000 filas de PostgREST que tendria un conteo hecho en el navegador.

create or replace function public.comment_counts(post_ids bigint[])
returns table (post_id bigint, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select c.post_id, count(*)::bigint as total
  from public.comments c
  where c.post_id = any(post_ids)
  group by c.post_id;
$$;

grant execute on function public.comment_counts(bigint[]) to anon, authenticated;
