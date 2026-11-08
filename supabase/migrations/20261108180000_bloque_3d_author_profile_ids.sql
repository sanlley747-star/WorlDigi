-- Bloque 3D — identidad interna de autores en posts, comments y likes.
-- Aditivo: no modifica user_email, permisos existentes ni políticas RLS.

alter table public.posts
  add column if not exists author_id uuid
  references public.profiles(profile_id) on delete set null;
alter table public.comments
  add column if not exists author_id uuid
  references public.profiles(profile_id) on delete set null;
alter table public.comment_likes
  add column if not exists author_id uuid
  references public.profiles(profile_id) on delete set null;
alter table public.post_likes
  add column if not exists author_id uuid
  references public.profiles(profile_id) on delete set null;

-- Backfill por correspondencia exacta del correo existente.
update public.posts x
set author_id = p.profile_id
from public.profiles p
where x.author_id is null and lower(x.user_email) = lower(p.user_email);
update public.comments x
set author_id = p.profile_id
from public.profiles p
where x.author_id is null and lower(x.user_email) = lower(p.user_email);
update public.comment_likes x
set author_id = p.profile_id
from public.profiles p
where x.author_id is null and lower(x.user_email) = lower(p.user_email);
update public.post_likes x
set author_id = p.profile_id
from public.profiles p
where x.author_id is null and lower(x.user_email) = lower(p.user_email);

create index if not exists posts_author_id_idx on public.posts(author_id);
create index if not exists comments_author_id_idx on public.comments(author_id);
create index if not exists comment_likes_author_id_idx on public.comment_likes(author_id);
create index if not exists post_likes_author_id_idx on public.post_likes(author_id);

-- Compatible con clientes y workers que siguen insertando user_email.
create or replace function public.trg_fill_author_profile_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.author_id is null and new.user_email is not null then
    select p.profile_id
      into new.author_id
      from public.profiles p
     where lower(p.user_email) = lower(new.user_email)
     limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_fill_author_profile_id on public.posts;
create trigger trg_fill_author_profile_id
before insert on public.posts
for each row execute function public.trg_fill_author_profile_id();

drop trigger if exists trg_fill_author_profile_id on public.comments;
create trigger trg_fill_author_profile_id
before insert on public.comments
for each row execute function public.trg_fill_author_profile_id();

drop trigger if exists trg_fill_author_profile_id on public.comment_likes;
create trigger trg_fill_author_profile_id
before insert on public.comment_likes
for each row execute function public.trg_fill_author_profile_id();

drop trigger if exists trg_fill_author_profile_id on public.post_likes;
create trigger trg_fill_author_profile_id
before insert on public.post_likes
for each row execute function public.trg_fill_author_profile_id();

revoke all on function public.trg_fill_author_profile_id() from public, anon, authenticated;

-- Perfil propio resuelto por UUID de sesión; compatibilidad con perfiles antiguos
-- que todavía no tienen auth_user_id vinculado.
create or replace function public.mi_perfil_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.profile_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
     or (
       p.auth_user_id is null
       and lower(p.user_email) = lower((select auth.email()))
     )
  order by case when p.auth_user_id = (select auth.uid()) then 0 else 1 end
  limit 1;
$function$;

revoke all on function public.mi_perfil_id() from public, anon;
grant execute on function public.mi_perfil_id() to authenticated;

-- Solo se añaden permisos SELECT para los nuevos UUID; los permisos actuales
-- de user_email y todas las políticas existentes quedan intactos.
grant select (profile_id) on public.profiles to anon, authenticated;
grant select (author_id) on public.posts to anon, authenticated;
grant select (author_id) on public.comments to anon, authenticated;
grant select (author_id) on public.comment_likes to anon, authenticated;
grant select (author_id) on public.post_likes to anon, authenticated;
