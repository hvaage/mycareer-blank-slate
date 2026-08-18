ALTER TABLE public.cv_review_progress DROP CONSTRAINT IF EXISTS cv_review_progress_current_step_check;
ALTER TABLE public.cv_review_progress ADD CONSTRAINT cv_review_progress_current_step_check CHECK (current_step BETWEEN 1 AND 5);

CREATE OR REPLACE FUNCTION public.cv_review_progress_advance(
  p_import_id uuid,
  p_signature text,
  p_step smallint,
  p_step_state jsonb DEFAULT NULL
)
RETURNS public.cv_review_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.cv_review_progress%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;

  SELECT * INTO v_row FROM public.cv_review_progress
  WHERE user_id = v_user AND import_id = p_import_id AND is_stale = false
  FOR UPDATE;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Ingen aktiv gjennomgang for denne importen'; END IF;
  IF v_row.candidate_set_signature <> p_signature THEN
    RAISE EXCEPTION 'Gjennomgangen gjelder et annet kandidatsett. Start gjennomgangen på nytt.';
  END IF;
  -- 5 = gjennomgangen er fullført (valgfritt AI-ettersteg)
  IF p_step < 1 OR p_step > 5 THEN RAISE EXCEPTION 'Ukjent trinn'; END IF;
  IF p_step > v_row.current_step + 1 THEN RAISE EXCEPTION 'Trinnene må tas i rekkefølge'; END IF;

  UPDATE public.cv_review_progress
  SET current_step = p_step,
      step_state = COALESCE(p_step_state, step_state),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cv_review_progress_advance(uuid,text,smallint,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cv_review_progress_advance(uuid,text,smallint,jsonb) TO authenticated, service_role;