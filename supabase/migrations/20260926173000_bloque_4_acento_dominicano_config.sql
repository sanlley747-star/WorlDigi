-- Bloque 4: asignación reproducible inicial del acento.
-- Semilla: ByGether-B4-v1
-- La segunda migración del bloque corrige la distribución a exactamente 90/10.

do $$
declare v_total integer;
begin
  select count(*) into v_total
  from public.profiles
  where is_cuenta_automatica=true
    and persona_id is not null
    and user_email like '%@sim.bygether.invalid';

  if v_total <> 100 then
    raise exception 'BLOQUE_4: se esperaban 100 cuentas-persona y se encontraron %', v_total;
  end if;

  update public.profiles p
  set config_cuenta_automatica =
    jsonb_set(
      coalesce(p.config_cuenta_automatica, '{}'::jsonb),
      '{acento}',
      to_jsonb(
        case
          when (('x' || substr(md5('ByGether-B4-v1|' || lower(p.user_email)), 1, 8))::bit(32)::bigint % 100) < 90
            then 'RD'
          else 'latam_mixto'
        end
      ),
      true
    )
  where p.is_cuenta_automatica=true
    and p.persona_id is not null
    and p.user_email like '%@sim.bygether.invalid';
end $$;
