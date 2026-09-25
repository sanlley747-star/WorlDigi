-- BLOQUE 4: Seguridad de sesion / manejo de sesion en frontend - ByGether
-- Aplicado directamente en el proyecto (ref: aiymadawznadvavzspxj) el 2026-09-25.

-- HALLAZGO CRITICO: la tabla "posts" tenia una sola politica de prueba que
-- quedo desde el inicio del proyecto:
--   CREATE POLICY "Permitir publicaciones" ON posts FOR ALL TO public
--     USING (true) WITH CHECK (true);
-- Esto permitia que cualquiera (incluso sin sesion) creara, editara o
-- borrara CUALQUIER post de CUALQUIER usuario llamando directo a la API
-- REST de Supabase, sin pasar por la app. Las demas tablas de usuario
-- (comments, post_likes, connections, profiles) ya seguian el patron
-- correcto (dueno de la fila = auth.email()); "posts" se habia quedado
-- atras. Se revisaron los usos reales en el frontend (dashboard.html,
-- publicacion.html, perfil.html): solo SELECT publico, INSERT con el
-- correo del usuario logueado, y DELETE solo de los propios reposts. No
-- hay ningun UPDATE directo sobre posts desde el cliente.

DROP POLICY IF EXISTS "Permitir publicaciones" ON public.posts;

CREATE POLICY posts_select_public
  ON public.posts FOR SELECT
  TO public
  USING (true);

CREATE POLICY posts_insert_own
  ON public.posts FOR INSERT
  TO authenticated
  WITH CHECK (user_email = auth.email());

CREATE POLICY posts_delete_own
  ON public.posts FOR DELETE
  TO authenticated
  USING (user_email = auth.email());

-- Se confirmo que el worker de cuentas automaticas (Edge Function
-- agent-worker, service_role) y las funciones SECURITY DEFINER que
-- publican contenido automatico no se ven afectadas: service_role y las
-- funciones definidas por "postgres" hacen bypass de RLS.

-- REVISION GENERAL: se corrio pg_policies sobre todo el esquema public
-- buscando otras politicas con qual/with_check = 'true'. Solo quedaron
-- politicas de SELECT publico (posts, comments, post_likes, comment_likes,
-- profiles, cuentas_canal), que es el comportamiento esperado: cualquiera
-- puede LEER contenido publico, pero ninguna permite escribir sin dueno.

-- FRONTEND: se revisaron dashboard.html, conexiones.html, notificaciones.html
-- y publicacion.html. Las 4 ya tenian implementado correctamente el patron
-- anti-flash de sesion (clase "auth-pending" que oculta el body hasta
-- confirmar sesion real via getSession()/getUser(), mas hideForAuth() en el
-- evento "pagehide" para que el bfcache del navegador nunca quede con el
-- contenido visible tras cerrar sesion). perfil.html no lleva ese candado
-- porque intencionalmente permite ver perfiles publicos sin sesion; sus
-- acciones de edicion ya verifican currentUserEmail antes de ejecutarse.
-- signOut() usa el scope global por defecto (revoca el refresh token en
-- servidor, no solo borra el token local). No se guarda nada sensible en
-- localStorage (solo preferencias de tema y tamano de letra).
