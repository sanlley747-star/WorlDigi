-- Bloque 3E — comment_likes: ocultar user_email sin alterar otros permisos.
revoke select (user_email) on table public.comment_likes from anon, authenticated;

-- ROLLBACK MANUAL (solo restaura el permiso que existía antes):
-- grant select (user_email) on table public.comment_likes to authenticated;
