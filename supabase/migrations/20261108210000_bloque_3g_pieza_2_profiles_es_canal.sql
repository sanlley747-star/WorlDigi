-- Bloque 3G / Pieza 2: indicador público mínimo para cuentas de canal.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS es_canal boolean NOT NULL DEFAULT false;

UPDATE public.profiles p
SET es_canal = EXISTS (
  SELECT 1 FROM public.cuentas_canal c
  WHERE lower(c.user_email) = lower(p.user_email)
)
WHERE p.es_canal IS DISTINCT FROM EXISTS (
  SELECT 1 FROM public.cuentas_canal c
  WHERE lower(c.user_email) = lower(p.user_email)
);

CREATE OR REPLACE FUNCTION public.profiles_sync_es_canal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.es_canal := EXISTS (
    SELECT 1 FROM public.cuentas_canal c
    WHERE lower(c.user_email) = lower(NEW.user_email)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_es_canal ON public.profiles;
CREATE TRIGGER trg_profiles_sync_es_canal
BEFORE INSERT OR UPDATE OF user_email ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_sync_es_canal();

CREATE OR REPLACE FUNCTION public.cuentas_canal_sync_es_canal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_email ELSE NEW.user_email END;
  UPDATE public.profiles p
  SET es_canal = EXISTS (
    SELECT 1 FROM public.cuentas_canal c
    WHERE lower(c.user_email) = lower(v_email)
  )
  WHERE lower(p.user_email) = lower(v_email);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuentas_canal_sync_es_canal ON public.cuentas_canal;
CREATE TRIGGER trg_cuentas_canal_sync_es_canal
AFTER INSERT OR DELETE ON public.cuentas_canal
FOR EACH ROW
EXECUTE FUNCTION public.cuentas_canal_sync_es_canal();

GRANT SELECT (es_canal) ON public.profiles TO anon, authenticated;
