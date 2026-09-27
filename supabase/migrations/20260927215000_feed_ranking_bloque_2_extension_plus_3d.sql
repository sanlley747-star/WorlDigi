-- ByGether — Feed Ranking
-- Bloque 2: extensión abierta +3 días y aumento dinámico de su peso.

insert into public.agent_config (clave, valor, descripcion)
values (
  'feed_ranking_recent_threshold',
  '100'::jsonb,
  'Umbral de cantidad total de posts en franjas 0-3h, 3-8h, 8-20h y 20h-3d para activar el incremento automático del peso +3d.'
)
on conflict (clave) do nothing;

create or replace function public.feed_ranking_page(
  p_seed float,
  p_exclude_ids bigint[],
  p_limit int
)
returns setof public.posts
language plpgsql
security invoker
set search_path = public, pg_catalog
as $function$
declare
  v_weights jsonb;
  v_recent_threshold double precision;
begin
  if p_seed < -1 or p_seed > 1 then
    raise exception 'p_seed must be between -1 and 1';
  end if;

  if p_limit is null or p_limit <= 0 then
    return;
  end if;

  perform pg_catalog.setseed(p_seed);

  select coalesce(
    (select valor from public.agent_config where clave = 'feed_ranking_weights'),
    '{"0_3h":0.35,"3_8h":0.25,"8_20h":0.20,"20h_3d":0.15,"plus_3d":0.05}'::jsonb
  ) into v_weights;

  select greatest(
    coalesce(
      (select (valor #>> '{}')::double precision
       from public.agent_config
       where clave = 'feed_ranking_recent_threshold'),
      100.0
    ),
    1.0
  ) into v_recent_threshold;

  return query
  with recursive
  base_bands(ord, band_key, base_weight) as (
    values
      (1, '0_3h',   greatest(coalesce((v_weights->>'0_3h')::double precision, 0.35), 0.0)),
      (2, '3_8h',   greatest(coalesce((v_weights->>'3_8h')::double precision, 0.25), 0.0)),
      (3, '8_20h',  greatest(coalesce((v_weights->>'8_20h')::double precision, 0.20), 0.0)),
      (4, '20h_3d', greatest(coalesce((v_weights->>'20h_3d')::double precision, 0.15), 0.0)),
      (5, 'plus_3d', greatest(coalesce((v_weights->>'plus_3d')::double precision, 0.05), 0.0))
  ),
  candidates as (
    select p.*,
      case
        when p.created_at >= now() - interval '3 hours' then '0_3h'
        when p.created_at >= now() - interval '8 hours' then '3_8h'
        when p.created_at >= now() - interval '20 hours' then '8_20h'
        when p.created_at >= now() - interval '3 days' then '20h_3d'
        else 'plus_3d'
      end as band_key
    from public.posts p
    where not (p.id = any(coalesce(p_exclude_ids, '{}'::bigint[])))
  ),
  recent_counts as (
    select count(*)::double precision as recent_count
    from candidates
    where band_key <> 'plus_3d'
  ),
  bands as (
    select b.ord, b.band_key,
      case
        when b.band_key = 'plus_3d' and rc.recent_count < v_recent_threshold
        then b.base_weight * (1.0 + (v_recent_threshold - rc.recent_count) / v_recent_threshold)
        else b.base_weight
      end as base_weight
    from base_bands b
    cross join recent_counts rc
  ),
  counts as (
    select b.ord, b.band_key, b.base_weight,
           count(c.id)::double precision as candidate_count
    from bands b
    left join candidates c on c.band_key = b.band_key
    group by b.ord, b.band_key, b.base_weight
  ),
  totals as (
    select coalesce(sum(base_weight), 0.0)::double precision as total_weight from counts
  ),
  adjusted(ord, band_key, candidate_count, incoming_weight, desired_slots,
            effective_weight, carried_weight, remaining_slots, remaining_weight) as (
    select c.ord, c.band_key, c.candidate_count, c.base_weight,
      case when t.total_weight > 0 then p_limit::double precision * c.base_weight / t.total_weight else 0.0 end,
      case
        when c.candidate_count <= 0 or t.total_weight <= 0 then 0.0
        else c.base_weight * least(1.0, c.candidate_count /
          greatest(p_limit::double precision * c.base_weight / t.total_weight, 1.0))
      end,
      case
        when c.candidate_count <= 0 or t.total_weight <= 0 then c.base_weight
        else c.base_weight - c.base_weight * least(1.0, c.candidate_count /
          greatest(p_limit::double precision * c.base_weight / t.total_weight, 1.0))
      end,
      greatest(p_limit::double precision - least(c.candidate_count,
        case when t.total_weight > 0 then p_limit::double precision * c.base_weight / t.total_weight else 0.0 end), 0.0),
      greatest(t.total_weight - case
        when c.candidate_count <= 0 or t.total_weight <= 0 then 0.0
        else c.base_weight * least(1.0, c.candidate_count /
          greatest(p_limit::double precision * c.base_weight / t.total_weight, 1.0))
      end, 0.0)
    from counts c cross join totals t where c.ord = 1

    union all

    select c.ord, c.band_key, c.candidate_count, c.base_weight + a.carried_weight,
      case when a.remaining_weight > 0 then a.remaining_slots * (c.base_weight + a.carried_weight) / a.remaining_weight else 0.0 end,
      case
        when c.candidate_count <= 0 or a.remaining_weight <= 0 then 0.0
        else (c.base_weight + a.carried_weight) * least(1.0, c.candidate_count /
          greatest(a.remaining_slots * (c.base_weight + a.carried_weight) / a.remaining_weight, 1.0))
      end,
      case
        when c.candidate_count <= 0 or a.remaining_weight <= 0 then c.base_weight + a.carried_weight
        else (c.base_weight + a.carried_weight) - (c.base_weight + a.carried_weight) * least(1.0, c.candidate_count /
          greatest(a.remaining_slots * (c.base_weight + a.carried_weight) / a.remaining_weight, 1.0))
      end,
      greatest(a.remaining_slots - least(c.candidate_count,
        case when a.remaining_weight > 0 then a.remaining_slots * (c.base_weight + a.carried_weight) / a.remaining_weight else 0.0 end), 0.0),
      greatest(a.remaining_weight - case
        when c.candidate_count <= 0 or a.remaining_weight <= 0 then 0.0
        else (c.base_weight + a.carried_weight) * least(1.0, c.candidate_count /
          greatest(a.remaining_slots * (c.base_weight + a.carried_weight) / a.remaining_weight, 1.0))
      end, 0.0)
    from adjusted a join counts c on c.ord = a.ord + 1
  ),
  effective as (
    select ord, band_key,
      case when effective_weight > 0 then effective_weight else 0.000000001 end as peso_franja
    from adjusted where candidate_count > 0
  ),
  ranked as (
    select c.*, e.peso_franja from candidates c join effective e using (band_key)
  )
  select r.id, r.created_at, r.user_email, r.image_url, r.likes, r.content,
         r.user_name, r.repost_of, r.quote_text, r.repost_of_comment_id, r.metadata
  from ranked r
  order by (pg_catalog.random() * r.peso_franja) desc
  limit p_limit;
end;
$function$;

grant execute on function public.feed_ranking_page(double precision,bigint[],integer)
to anon, authenticated;
