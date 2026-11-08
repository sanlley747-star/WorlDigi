-- Reversión de Bloque 3G / Pieza 2.
DROP TRIGGER IF EXISTS trg_cuentas_canal_sync_es_canal ON public.cuentas_canal;
DROP TRIGGER IF EXISTS trg_profiles_sync_es_canal ON public.profiles;
DROP FUNCTION IF EXISTS public.cuentas_canal_sync_es_canal();
DROP FUNCTION IF EXISTS public.profiles_sync_es_canal();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS es_canal;
