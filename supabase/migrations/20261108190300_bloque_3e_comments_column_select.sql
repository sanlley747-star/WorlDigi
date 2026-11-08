-- Bloque 3E — reemplaza SELECT de tabla por SELECT explícito sin user_email.
revoke select on table public.comments from authenticated;
grant select (id, post_id, user_name, content, created_at, reply_to, author_id)
  on table public.comments to authenticated;

-- ROLLBACK MANUAL:
-- grant select on table public.comments to authenticated;
