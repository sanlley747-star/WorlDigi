-- Bloque 3E — reemplaza SELECT de tabla por SELECT explícito sin user_email.
revoke select on table public.comment_likes from authenticated;
grant select (id, comment_id, user_name, created_at, author_id)
  on table public.comment_likes to authenticated;

-- ROLLBACK MANUAL:
-- grant select on table public.comment_likes to authenticated;
