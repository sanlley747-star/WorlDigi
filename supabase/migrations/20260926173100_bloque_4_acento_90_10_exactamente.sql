-- Bloque 4: distribución final exactamente 90 cuentas RD / 10 cuentas latam_mixto.
-- Semilla auditable/reproducible: ByGether-B4-v1
-- El orden se obtiene por md5(semilla|email), con email como desempate.

with orden as (
  select user_email,
         row_number() over (
           order by md5('ByGether-B4-v1|' || lower(user_email)), lower(user_email)
         ) as rn
  from public.profiles
  where is_cuenta_automatica=true
    and persona_id is not null
    and user_email like '%@sim.bygether.invalid'
)
update public.profiles p
set config_cuenta_automatica =
  jsonb_set(
    coalesce(p.config_cuenta_automatica, '{}'::jsonb),
    '{acento}',
    to_jsonb(case when o.rn <= 90 then 'RD' else 'latam_mixto' end),
    true
  )
from orden o
where p.user_email=o.user_email;
