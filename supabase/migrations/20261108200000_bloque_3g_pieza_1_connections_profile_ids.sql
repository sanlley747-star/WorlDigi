-- Bloque 3G / Pieza 1: conexiones pasan a identidad profile_id.
-- Compatible con clientes antiguos: los correos se mantienen y se rellenan en el trigger.

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS follower_id uuid,
  ADD COLUMN IF NOT EXISTS following_id uuid;

UPDATE public.connections c
SET follower_id = f.profile_id,
    following_id = g.profile_id
FROM public.profiles f, public.profiles g
WHERE lower(f.user_email) = lower(c.follower_email)
  AND lower(g.user_email) = lower(c.following_email)
  AND (c.follower_id IS DISTINCT FROM f.profile_id
       OR c.following_id IS DISTINCT FROM g.profile_id);

CREATE OR REPLACE FUNCTION public.connections_prepare_profile_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_follower public.profiles%ROWTYPE;
  v_following public.profiles%ROWTYPE;
BEGIN
  IF NEW.follower_id IS NOT NULL THEN
    SELECT p.* INTO v_follower
    FROM public.profiles p
    WHERE p.profile_id = NEW.follower_id
    LIMIT 1;
  ELSIF NEW.follower_email IS NOT NULL THEN
    SELECT p.* INTO v_follower
    FROM public.profiles p
    WHERE lower(p.user_email) = lower(NEW.follower_email)
    LIMIT 1;
  END IF;

  IF NEW.following_id IS NOT NULL THEN
    SELECT p.* INTO v_following
    FROM public.profiles p
    WHERE p.profile_id = NEW.following_id
    LIMIT 1;
  ELSIF NEW.following_email IS NOT NULL THEN
    SELECT p.* INTO v_following
    FROM public.profiles p
    WHERE lower(p.user_email) = lower(NEW.following_email)
    LIMIT 1;
  END IF;

  IF v_follower.profile_id IS NULL OR v_following.profile_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver la identidad de ambos perfiles de la conexión'
      USING ERRCODE = '23503';
  END IF;

  -- profile_id prevalece si el cliente nuevo lo envía; el correo queda como compatibilidad.
  NEW.follower_id := v_follower.profile_id;
  NEW.follower_email := v_follower.user_email;
  NEW.follower_name := coalesce(NEW.follower_name, v_follower.user_name);
  NEW.following_id := v_following.profile_id;
  NEW.following_email := v_following.user_email;
  NEW.following_name := coalesce(NEW.following_name, v_following.user_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_connections_prepare_profile_ids ON public.connections;
CREATE TRIGGER trg_connections_prepare_profile_ids
BEFORE INSERT ON public.connections
FOR EACH ROW
EXECUTE FUNCTION public.connections_prepare_profile_ids();

-- La lectura existente no cambia: SELECT sigue limitado a las filas propias.
-- INSERT/DELETE ahora se validan por la identidad interna de sesión.
DROP POLICY IF EXISTS connections_insert_own ON public.connections;
CREATE POLICY connections_insert_own
ON public.connections
FOR INSERT TO authenticated
WITH CHECK (follower_id = (SELECT public.mi_perfil_id()));

DROP POLICY IF EXISTS connections_delete_own ON public.connections;
CREATE POLICY connections_delete_own
ON public.connections
FOR DELETE TO authenticated
USING (follower_id = (SELECT public.mi_perfil_id()));

GRANT SELECT (follower_id, following_id) ON public.connections TO authenticated;
GRANT INSERT (follower_id, following_id) ON public.connections TO authenticated;
