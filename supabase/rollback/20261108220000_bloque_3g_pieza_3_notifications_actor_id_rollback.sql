-- Reversión de Bloque 3G / Pieza 3.
DROP TRIGGER IF EXISTS trg_notifications_prepare_actor_id ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_prepare_actor_id();
REVOKE SELECT (actor_id) ON public.notifications FROM authenticated;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS actor_id;
