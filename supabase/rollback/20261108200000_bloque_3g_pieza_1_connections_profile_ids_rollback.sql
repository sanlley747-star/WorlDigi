-- Reversión de Bloque 3G / Pieza 1.
DROP POLICY IF EXISTS connections_insert_own ON public.connections;
CREATE POLICY connections_insert_own
ON public.connections FOR INSERT TO authenticated
WITH CHECK (follower_email = (SELECT auth.email()));

DROP POLICY IF EXISTS connections_delete_own ON public.connections;
CREATE POLICY connections_delete_own
ON public.connections FOR DELETE TO authenticated
USING (follower_email = (SELECT auth.email()));

DROP TRIGGER IF EXISTS trg_connections_prepare_profile_ids ON public.connections;
DROP FUNCTION IF EXISTS public.connections_prepare_profile_ids();

REVOKE SELECT (follower_id, following_id) ON public.connections FROM authenticated;
REVOKE INSERT (follower_id, following_id) ON public.connections FROM authenticated;

ALTER TABLE public.connections
  DROP COLUMN IF EXISTS follower_id,
  DROP COLUMN IF EXISTS following_id;
