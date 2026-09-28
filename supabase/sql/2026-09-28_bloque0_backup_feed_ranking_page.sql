CREATE OR REPLACE FUNCTION public.feed_ranking_page(p_user_email text, p_exclude_ids bigint[], p_limit integer, p_cooldown_hours integer DEFAULT 6)
 RETURNS SETOF posts
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_base_quota int;
  v_remainder int;
  v_target int;
  v_selected_count int;
  v_carry int := 0;
  v_band int;
  v_i int;
  v_quota int[];
  v_selected_ids bigint[] := '{}'::bigint[];
  v_head_ids bigint[] := '{}'::bigint[];
  v_algorithm_ids bigint[] := '{}'::bigint[];
  v_ordered_algorithm_ids bigint[] := '{}'::bigint[];
  v_ordered_ids bigint[] := '{}'::bigint[];
  v_band_ids bigint[];
  v_head_count int := 0;
  v_algorithm_limit int;
  v_now timestamptz := now();
  v_is_scroll boolean;
begin
  if p_user_email is null or btrim(p_user_email) = '' then
    raise exception 'p_user_email is required';
  end if;

  if p_limit is null or p_limit <= 0 then
    return;
  end if;

  if p_limit < 10 then
    raise exception 'p_limit must be >= 10';
  end if;

  v_is_scroll := coalesce(array_length(p_exclude_ids, 1), 0) > 0;

  /*
    REFRESH:
    #1 = 0-2h, una publicación aleatoria.
    Restantes 19:
    2-5h=2, 5-10h=3, 10-24h=4, 1-3d=4, 4-6d=3, +6d=3.
  */
  if not v_is_scroll then
    v_head_count := 1;

    select coalesce(array_agg(id order by pg_catalog.random()), '{}'::bigint[])
      into v_head_ids
    from (
      select p.id
      from public.posts p
      where p.created_at >= v_now - interval '2 hours'
      order by pg_catalog.random()
      limit 1
    ) recent;

    v_selected_ids := v_head_ids;
    v_algorithm_limit := p_limit - coalesce(array_length(v_head_ids, 1), 0);

    if v_algorithm_limit <= 0 then
      v_ordered_ids := v_head_ids;
    else
      if coalesce(array_length(v_head_ids, 1), 0) = 1 and v_algorithm_limit = 19 then
        v_quota := array[0,2,3,4,4,3,3];
      else
        v_base_quota := v_algorithm_limit / 6;
        v_remainder := v_algorithm_limit % 6;
        v_quota := array[0,v_base_quota,v_base_quota,v_base_quota,v_base_quota,v_base_quota,v_base_quota];
        for v_i in 1..v_remainder loop
          v_quota[v_i + 1] := v_quota[v_i + 1] + 1;
        end loop;
      end if;

      for v_band in 2..7 loop
        v_target := v_quota[v_band] + v_carry;
        v_carry := 0;
        v_band_ids := '{}'::bigint[];

        if v_target <= 0 then
          continue;
        end if;

        with band_candidates as (
          select p.id
          from public.posts p
          left join public.feed_seen fs
            on fs.user_email = p_user_email
           and fs.post_id = p.id
          where not (p.id = any(coalesce(p_exclude_ids, '{}'::bigint[])))
            and not (p.id = any(coalesce(v_selected_ids, '{}'::bigint[])))
            and (
              case
                when p.created_at >= v_now - interval '2 hours' then 1
                when p.created_at >= v_now - interval '5 hours' then 2
                when p.created_at >= v_now - interval '10 hours' then 3
                when p.created_at >= v_now - interval '24 hours' then 4
                when p.created_at >= v_now - interval '3 days' then 5
                when p.created_at >= v_now - interval '6 days' then 6
                else 7
              end
            ) = v_band
          order by
            case when fs.post_id is null then 0 else 1 end asc,
            fs.last_shown_at asc nulls first,
            pg_catalog.random()
          limit v_target
        )
        select coalesce(array_agg(id order by pg_catalog.random()), '{}'::bigint[])
          into v_band_ids
        from band_candidates;

        v_selected_count := coalesce(array_length(v_band_ids, 1), 0);
        v_selected_ids := v_selected_ids || v_band_ids;

        if v_selected_count < v_target then
          v_carry := v_target - v_selected_count;
        end if;
      end loop;

      v_algorithm_ids := v_selected_ids[
        coalesce(array_length(v_head_ids, 1), 0) + 1:
        array_length(v_selected_ids, 1)
      ];

      if coalesce(array_length(v_algorithm_ids, 1), 0) > 0 then
        with recursive
        candidates as (
          select
            p.id,
            p.user_email as author,
            case
              when p.created_at >= v_now - interval '2 hours' then 1
              when p.created_at >= v_now - interval '5 hours' then 2
              when p.created_at >= v_now - interval '10 hours' then 3
              when p.created_at >= v_now - interval '24 hours' then 4
              when p.created_at >= v_now - interval '3 days' then 5
              when p.created_at >= v_now - interval '6 days' then 6
              else 7
            end as band
          from public.posts p
          where p.id = any(v_algorithm_ids)
        ),
        ordered as (
          select 0 as n, null::text as last_author, 0 as last_band,
                 0 as band_run, '{}'::bigint[] as path
          union all
          select
            o.n + 1,
            pick.author,
            pick.band,
            case when pick.band = o.last_band then o.band_run + 1 else 1 end,
            o.path || pick.id
          from ordered o
          cross join lateral (
            select c.*
            from candidates c
            where not (c.id = any(o.path))
              and c.author is distinct from o.last_author
              and (c.band <> o.last_band or o.band_run < 2)
            order by pg_catalog.random()
            limit 1
          ) pick
        )
        select path into v_ordered_algorithm_ids
        from ordered
        order by n desc
        limit 1;
      end if;

      v_ordered_ids := v_head_ids || coalesce(v_ordered_algorithm_ids, '{}'::bigint[]);
    end if;

  /*
    SCROLL:
    0-2h excluded.
    Fixed quotas and fixed presentation order:
    2-5h=2, 5-10h=3, 10-24h=4, 1-3d=5, 4-6d=3, +6d=3.
    Within each band: unseen first, then oldest last_shown_at, random tie-break.
    The six band blocks are concatenated in chronological-band order.
  */
  else
    v_quota := array[0,2,3,4,5,3,3];

    for v_band in 2..7 loop
      v_target := v_quota[v_band];
      v_band_ids := '{}'::bigint[];

      if v_target <= 0 then
        continue;
      end if;

      with band_candidates as (
        select p.id
        from public.posts p
        left join public.feed_seen fs
          on fs.user_email = p_user_email
         and fs.post_id = p.id
        where not (p.id = any(coalesce(p_exclude_ids, '{}'::bigint[])))
          and (
            case
              when p.created_at >= v_now - interval '2 hours' then 1
              when p.created_at >= v_now - interval '5 hours' then 2
              when p.created_at >= v_now - interval '10 hours' then 3
              when p.created_at >= v_now - interval '24 hours' then 4
              when p.created_at >= v_now - interval '3 days' then 5
              when p.created_at >= v_now - interval '6 days' then 6
              else 7
            end
          ) = v_band
        order by
          case when fs.post_id is null then 0 else 1 end asc,
          fs.last_shown_at asc nulls first,
          pg_catalog.random()
        limit v_target
      )
      select coalesce(array_agg(id order by pg_catalog.random()), '{}'::bigint[])
        into v_band_ids
      from band_candidates;

      v_selected_ids := v_selected_ids || v_band_ids;
    end loop;

    v_ordered_ids := v_selected_ids;
  end if;

  if coalesce(array_length(v_ordered_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.feed_seen (user_email, post_id, last_shown_at)
  select p_user_email, x.post_id, v_now
  from unnest(v_ordered_ids) as x(post_id)
  on conflict (user_email, post_id)
  do update set last_shown_at = excluded.last_shown_at;

  return query
  select p.*
  from unnest(v_ordered_ids) with ordinality as x(post_id, ord)
  join public.posts p on p.id = x.post_id
  order by x.ord;
end;
$function$

