-- BLOQUE 2: Seguridad Supabase Auth / RLS - ByGether
-- Aplicado directamente en el proyecto (ref: aiymadawznadvavzspxj) el 2026-09-24/25.
-- Este archivo documenta los cambios para el repositorio (control de versiones).

-- 1) Cerrar 19 tablas internas del sistema de agentes que tenian RLS activado
--    pero sin ninguna politica (quedaban en deny-by-default implicito; ahora
--    quedan explicitamente bloqueadas para anon/authenticated).
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'agent_config','agent_image_log','agent_llm_calls','agent_personas','agent_queue',
    'agent_worker_state','centinela_log','centinela_reglas','content_messages','content_photos',
    'enlaces_publicados','fuentes_noticias','news_published','news_sources','noticias_usadas',
    'post_image_desc','seed_caras','youtube_published','youtube_sources'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'CREATE POLICY solo_service_role ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);',
      t
    );
  END LOOP;
END $$;

-- 2) Revocar ejecucion publica (PUBLIC) de funciones SECURITY DEFINER que no
--    deben ser llamables directo por clientes via /rest/v1/rpc/...
--    (Postgres otorga EXECUTE a PUBLIC por defecto al crear una funcion; hay
--    que revocarlo explicitamente de PUBLIC, no solo de anon/authenticated).
REVOKE EXECUTE ON FUNCTION public.agent_queue_normalizar_noticias() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_comment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_connection() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_like() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_repost() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publicar_contenido_automatico(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.worker_completar_post(bigint, text, text, text, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.agent_queue_normalizar_noticias() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.notify_on_comment() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.notify_on_connection() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.notify_on_like() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.notify_on_repost() TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.publicar_contenido_automatico(text, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.worker_completar_post(bigint, text, text, text, text, jsonb) TO service_role, postgres;

-- 3) Fijar search_path en funciones que lo tenian mutable (previene inyeccion
--    de esquema via search_path manipulado).
ALTER FUNCTION public.publicar_contenido_automatico(text, text) SET search_path = public;
ALTER FUNCTION public.centinela_similitud(text, text) SET search_path = public;
ALTER FUNCTION public.centinela_normalizar(text) SET search_path = public;

-- PENDIENTE (requiere revision aparte, no aplicado en este bloque):
-- - Extension pg_net sigue en esquema public: Postgres no permite
--   ALTER EXTENSION pg_net SET SCHEMA en esta version. Moverla implica
--   DROP/CREATE, lo cual puede romper triggers o pg_cron que llaman a
--   net.http_post(); se revisara en un bloque dedicado.
-- - "Leaked password protection" (HaveIBeenPwned) esta desactivado en Auth.
--   Es un toggle de configuracion (no SQL), se activa desde el dashboard de
--   Supabase en Authentication > Policies > Password Security.
