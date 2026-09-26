alter table public.agent_worker_state
  add column if not exists ultimo_action_type text,
  add column if not exists ultimo_agent_id text;

create or replace function public.claim_agent_tasks(
  p_limit integer default 1,
  p_types text[] default null
)
returns setof public.agent_queue
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer := greatest(coalesce(p_limit,1),1);
  v_i integer;
  v_id bigint;
  v_row public.agent_queue%rowtype;
  v_last_type text;
  v_last_agent text;
begin
  update public.agent_queue
     set status = 'pending'
   where status = 'processing'
     and started_at < now() - interval '10 minutes';

  with bloqueadas as (
    select q.id, q.agent_id, q.target_id, e.e
      from public.agent_queue q
      cross join lateral (
        select public.centinela_estado_hilo(
          case when q.target_id ~ '^[0-9]+$' then q.target_id::bigint end,
          q.agent_id
        ) as e
      ) e
     where q.status = 'pending'
       and q.action_type = 'COMMENT'
       and q.scheduled_at <= now()
       and q.target_id ~ '^[0-9]+$'
       and not coalesce((e.e ->> 'puede')::boolean, true)
  ), cerradas as (
    update public.agent_queue q
       set status = 'failed',
           completed_at = now(),
           last_error = left('centinela: ' || (b.e ->> 'motivo'), 500)
      from bloqueadas b
     where q.id = b.id
    returning q.id, q.agent_id, q.target_id, q.last_error
  )
  insert into public.centinela_log (agent_id, post_id, task_id, tipo, motivo)
  select agent_id, target_id::bigint, id, 'bucle', last_error
    from cerradas;

  perform pg_advisory_xact_lock(hashtext('claim_agent_tasks_round_robin'));

  select ultimo_action_type, ultimo_agent_id
    into v_last_type, v_last_agent
    from public.agent_worker_state
   where id = 1
   for update;

  for v_i in 1..v_n loop
    v_id := null;

    select q.id
      into v_id
      from public.agent_queue q
     where q.status = 'pending'
       and q.scheduled_at <= now()
       and (p_types is null or q.action_type = any(p_types))
     order by
       case
         when v_last_type is not null and q.action_type <> v_last_type then 0
         else 1
       end,
       case
         when v_last_agent is not null and q.agent_id <> v_last_agent then 0
         else 1
       end,
       q.priority,
       q.scheduled_at,
       q.id
     limit 1
     for update skip locked;

    exit when v_id is null;

    update public.agent_queue q
       set status = 'processing',
           started_at = now(),
           attempts = q.attempts + 1
     where q.id = v_id
    returning q.* into v_row;

    update public.agent_worker_state
       set ultimo_action_type = v_row.action_type,
           ultimo_agent_id = v_row.agent_id,
           updated_at = now()
     where id = 1;

    v_last_type := v_row.action_type;
    v_last_agent := v_row.agent_id;

    return next v_row;
  end loop;

  return;
end
$function$;
