revoke all on function public.interaccion_repost(boolean) from public;
revoke all on function public.interaccion_repost(boolean, boolean) from public;
revoke all on function public.worker_completar_cita(bigint, bigint, text, text) from public;
grant execute on function public.interaccion_repost(boolean) to service_role;
grant execute on function public.interaccion_repost(boolean, boolean) to service_role;
grant execute on function public.worker_completar_cita(bigint, bigint, text, text) to service_role;