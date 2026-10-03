create or replace function public.notify_on_share_link(p_post_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_actor text := (auth.jwt() ->> 'email');
  v_actor_name text := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    split_part(auth.jwt() ->> 'email', '@', 1)
  );
begin
  if v_actor is null then return; end if;

  select user_email into v_owner
  from public.posts
  where id = p_post_id;

  if v_owner is null or lower(v_owner) = lower(v_actor) then
    return;
  end if;

  insert into public.notifications
    (recipient_email, actor_email, actor_name, type, post_id)
  values
    (v_owner, v_actor, v_actor_name, 'share_link', p_post_id);
end;
$$;

revoke execute on function public.notify_on_share_link(bigint) from public, anon;
grant execute on function public.notify_on_share_link(bigint) to authenticated;
