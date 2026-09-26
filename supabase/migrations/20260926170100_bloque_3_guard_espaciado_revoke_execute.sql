-- ByGether - Bloque 3: el guardia de espaciado solo se ejecuta como trigger.
REVOKE EXECUTE ON FUNCTION public.guard_espaciado_posts_automaticos() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_espaciado_posts_automaticos() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_espaciado_posts_automaticos() FROM authenticated;
