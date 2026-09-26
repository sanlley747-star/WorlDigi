-- Bloque 5: preservar la firma anterior de interaccion_repost y cerrar acceso publico.
create or replace function public.interaccion_repost(p_dry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.interaccion_repost(p_dry, false);
end
$function$;

revoke execute on function public.interaccion_repost(boolean) from anon, authenticated;
revoke execute on function public.interaccion_repost(boolean, boolean) from anon, authenticated;
revoke execute on function public.worker_completar_cita(bigint, bigint, text, text) from anon, authenticated;
grant execute on function public.interaccion_repost(boolean) to service_role;
grant execute on function public.interaccion_repost(boolean, boolean) to service_role;
grant execute on function public.worker_completar_cita(bigint, bigint, text, text) to service_role;

create index if not exists posts_user_repost_idx on public.posts (user_email, repost_of);
create index if not exists agent_queue_quote_pending_idx
  on public.agent_queue (agent_id, created_at)
  where action_type='REPOST'
    and status in ('pending','processing')
    and coalesce((payload ->> 'con_cita')::boolean,false);