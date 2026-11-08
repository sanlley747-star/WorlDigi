-- Trigger-only function; never expose it as a callable PostgREST RPC.
revoke all on function public.profiles_prepare_identity() from public, anon, authenticated, service_role;
