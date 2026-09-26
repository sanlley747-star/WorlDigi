-- ByGether - Bloque 3: espaciado real de publicaciones automáticas
-- El planificador ya comprueba posts recientes, pero esa comprobación no protege
-- las rutas que insertan directamente en public.posts. Este guardia es la barrera
-- definitiva en la tabla y usa el mismo límite configurable del planificador.

CREATE OR REPLACE FUNCTION public.guard_espaciado_posts_automaticos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_horas integer;
  v_ultimo timestamptz;
BEGIN
  IF NEW.repost_of IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.is_cuenta_automatica
      AND lower(pr.user_email) = lower(NEW.user_email)
  ) THEN
    RETURN NEW;
  END IF;

  v_min_horas := COALESCE(
    (public.agent_cfg('planificador_limites') ->> 'min_horas_entre_posts')::integer,
    8
  );

  -- Serializa publicaciones de la misma cuenta para evitar una carrera
  -- entre dos procesos que comprueben el último post simultáneamente.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('bygether:auto-post:' || lower(NEW.user_email), 0)
  );

  SELECT max(p.created_at)
    INTO v_ultimo
  FROM public.posts p
  WHERE p.user_email = NEW.user_email
    AND p.repost_of IS NULL;

  IF v_ultimo IS NOT NULL
     AND NEW.created_at < v_ultimo + make_interval(hours => v_min_horas)
  THEN
    RAISE EXCEPTION
      'AUTO_POST_SPACING: cuenta % no puede publicar antes de %; ultimo post %, minimo % horas',
      NEW.user_email,
      v_ultimo + make_interval(hours => v_min_horas),
      v_ultimo,
      v_min_horas
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_espaciado_posts_automaticos ON public.posts;

CREATE TRIGGER trg_guard_espaciado_posts_automaticos
BEFORE INSERT ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.guard_espaciado_posts_automaticos();
