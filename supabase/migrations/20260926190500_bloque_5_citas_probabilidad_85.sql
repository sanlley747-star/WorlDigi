-- Ajuste Bloque 5: probabilidad de cita 85%.
-- Con cuota de 18/dia, produce una expectativa de ~15.3 citas/dia antes de restricciones de elegibilidad.
update public.agent_config
set valor=jsonb_set(coalesce(valor,'{}'::jsonb),'{prob_cita}','0.85'::jsonb,true)
where clave='interacciones_limites';