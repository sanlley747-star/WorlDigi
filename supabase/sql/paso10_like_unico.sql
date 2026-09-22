-- ============================================================
-- PASO 10: EVITAR "ME GUSTA" DUPLICADOS POR USUARIO
-- ============================================================
-- Antes, un mismo usuario podía dar "me gusta" varias veces a la misma
-- publicación (al refrescar la página o volver a encontrarla, el botón
-- volvía a sumar). Esto agrega una restricción de unicidad en post_likes
-- (un usuario solo puede tener UNA fila de "me gusta" por publicación),
-- para que la base de datos lo impida aunque falle una validación en la app.
--
-- Es seguro ejecutar este script más de una vez.
--
-- IMPORTANTE: si ya existen "me gusta" duplicados (de antes de este cambio),
-- este script los limpia primero (deja solo el más antiguo de cada usuario
-- por publicación) para poder crear el índice único.

-- 1) Limpieza de duplicados existentes (si los hay). Se usa ctid (identificador
-- físico de fila de Postgres) en vez del nombre de una columna, para que funcione
-- sin importar cómo se llame la clave primaria de la tabla.
delete from public.post_likes a
using public.post_likes b
where a.post_id = b.post_id
  and a.user_email = b.user_email
  and a.ctid > b.ctid;

-- 2) Restricción de unicidad: un usuario, un "me gusta" por publicación
create unique index if not exists post_likes_unico_por_usuario
  on public.post_likes (post_id, user_email);
