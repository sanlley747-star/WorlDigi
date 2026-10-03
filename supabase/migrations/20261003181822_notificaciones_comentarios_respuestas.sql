-- ByGether — Bloque 2: notificar respuestas y activar Realtime
-- Idempotente: no modifica RLS, políticas ni el trigger existente.

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner text;
  v_parent_author text;
begin
  select user_email into v_owner
  from public.posts
  where id = new.post_id;

  -- Comportamiento existente: notificar al dueño del post si no es quien comenta.
  if v_owner is not null and v_owner <> new.user_email then
    insert into public.notifications
      (recipient_email, actor_email, actor_name, type, post_id, comment_id)
    values
      (v_owner, new.user_email, new.user_name, 'comment', new.post_id, new.id);
  end if;

  -- Si es una respuesta, notificar también al autor del comentario padre,
  -- evitando duplicar la notificación cuando coincide con el dueño del post.
  if new.reply_to is not null then
    select user_email into v_parent_author
    from public.comments
    where id = new.reply_to;

    if v_parent_author is not null
       and v_parent_author <> new.user_email
       and v_parent_author is distinct from v_owner then
      insert into public.notifications
        (recipient_email, actor_email, actor_name, type, post_id, comment_id)
      values
        (v_parent_author, new.user_email, new.user_name, 'comment', new.post_id, new.id);
    end if;
  end if;

  return new;
end;
$function$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
