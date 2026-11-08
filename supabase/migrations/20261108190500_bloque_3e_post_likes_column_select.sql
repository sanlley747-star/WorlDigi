-- Bloque 3E — reemplaza SELECT de tabla por SELECT explícito sin user_email.
revoke select on table public.post_likes from authenticated;
grant select (id, post_id, user_name, created_at, author_id)
  on table public.post_likes to authenticated;

-- ROLLBACK MANUAL:
-- grant select on table public.post_likes to authenticated;
