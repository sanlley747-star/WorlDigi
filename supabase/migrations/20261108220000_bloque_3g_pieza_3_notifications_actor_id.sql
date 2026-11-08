-- Bloque 3G / Pieza 3: actor_id interno para notificaciones.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid;

UPDATE public.notifications n
SET actor_id = p.profile_id
FROM public.profiles p
WHERE n.actor_email IS NOT NULL
  AND lower(p.user_email) = lower(n.actor_email)
  AND n.actor_id IS DISTINCT FROM p.profile_id;

CREATE OR REPLACE FUNCTION public.notifications_prepare_actor_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT p.* INTO v_profile
    FROM public.profiles p
    WHERE p.profile_id = NEW.actor_id
    LIMIT 1;
  ELSIF NEW.actor_email IS NOT NULL THEN
    SELECT p.* INTO v_profile
    FROM public.profiles p
    WHERE lower(p.user_email) = lower(NEW.actor_email)
    LIMIT 1;
  END IF;

  IF v_profile.profile_id IS NOT NULL THEN
    NEW.actor_id := v_profile.profile_id;
    NEW.actor_email := v_profile.user_email;
    NEW.actor_name := coalesce(NEW.actor_name, v_profile.user_name);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_prepare_actor_id ON public.notifications;
CREATE TRIGGER trg_notifications_prepare_actor_id
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notifications_prepare_actor_id();

-- La política RLS existente limita las filas al destinatario; este permiso solo añade la columna.
GRANT SELECT (actor_id) ON public.notifications TO authenticated;
