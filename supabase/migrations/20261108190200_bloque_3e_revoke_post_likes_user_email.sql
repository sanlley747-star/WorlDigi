-- Bloque 3E — post_likes: ocultar user_email sin alterar otros permisos.
revoke select (user_email) on table public.post_likes from anon, authenticated;

-- ROLLBACK MANUAL (solo restaura el permiso que existía antes):
-- grant select (user_email) on table public.post_likes to authenticated;
