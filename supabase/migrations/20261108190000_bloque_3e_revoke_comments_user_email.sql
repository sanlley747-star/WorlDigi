-- Bloque 3E — comments: ocultar user_email sin alterar otros permisos.
revoke select (user_email) on table public.comments from anon, authenticated;

-- ROLLBACK MANUAL (solo restaura el permiso que existía antes):
-- grant select (user_email) on table public.comments to authenticated;
