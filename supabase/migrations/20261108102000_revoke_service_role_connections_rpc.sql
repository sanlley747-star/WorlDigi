-- Restringe las funciones públicas del Bloque 3B exclusivamente a anon y authenticated.
revoke execute on function public.connections_counts_by_username(text) from service_role;
revoke execute on function public.connections_followers_by_username(text, integer, integer) from service_role;
revoke execute on function public.connections_following_by_username(text, integer, integer) from service_role;