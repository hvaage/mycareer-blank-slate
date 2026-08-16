ALTER TABLE public.cv_document_claims DROP CONSTRAINT IF EXISTS cv_document_claims_verification_check;
ALTER TABLE public.cv_document_claims ADD CONSTRAINT cv_document_claims_verification_check
  CHECK (verification = ANY (ARRAY['supported','partially_supported','unsupported','not_applicable','user_attested','contradicted']));

CREATE TABLE IF NOT EXISTS public.cv_claim_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  claim_id text NOT NULL,
  attested_by_user_id uuid NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  attested_claim_text text NOT NULL,
  attested_claim_hash text NOT NULL,
  note text,
  external_source_name text,
  external_source_year integer,
  external_document_available boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  withdrawn_reason text,
  invalidated_at timestamptz,
  invalidated_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cv_claim_attestations_active_uidx
  ON public.cv_claim_attestations (document_id, claim_id)
  WHERE withdrawn_at IS NULL AND invalidated_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.cv_claim_attestations TO authenticated;
GRANT ALL ON public.cv_claim_attestations TO service_role;
ALTER TABLE public.cv_claim_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own attestations readable" ON public.cv_claim_attestations
  FOR SELECT TO authenticated USING (attested_by_user_id = auth.uid());
CREATE POLICY "own attestations insertable" ON public.cv_claim_attestations
  FOR INSERT TO authenticated WITH CHECK (
    attested_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cv_document_claims c
       WHERE c.document_id = cv_claim_attestations.document_id
         AND c.claim_id = cv_claim_attestations.claim_id
         AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "own attestations updatable" ON public.cv_claim_attestations
  FOR UPDATE TO authenticated USING (attested_by_user_id = auth.uid())
  WITH CHECK (attested_by_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.cv_claim_attestation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attestation_id uuid NOT NULL REFERENCES public.cv_claim_attestations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind = ANY (ARRAY['attested','withdrawn','invalidated'])),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cv_claim_attestation_events TO authenticated;
GRANT ALL ON public.cv_claim_attestation_events TO service_role;
ALTER TABLE public.cv_claim_attestation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attestation events readable" ON public.cv_claim_attestation_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.cv_claim_attestation_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.attested_claim_hash := md5(btrim(NEW.attested_claim_text));
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cv_claim_attestation_before_write ON public.cv_claim_attestations;
CREATE TRIGGER cv_claim_attestation_before_write
BEFORE INSERT OR UPDATE ON public.cv_claim_attestations
FOR EACH ROW EXECUTE FUNCTION public.cv_claim_attestation_before_write();

CREATE OR REPLACE FUNCTION public.cv_claim_attestation_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cv_claim_attestation_events (attestation_id, user_id, event_kind, detail)
    VALUES (NEW.id, NEW.attested_by_user_id, 'attested',
            jsonb_build_object('claim_id', NEW.claim_id, 'document_id', NEW.document_id));
  ELSIF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN
    INSERT INTO public.cv_claim_attestation_events (attestation_id, user_id, event_kind, detail)
    VALUES (NEW.id, NEW.attested_by_user_id, 'withdrawn', jsonb_build_object('reason', NEW.withdrawn_reason));
  ELSIF NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL THEN
    INSERT INTO public.cv_claim_attestation_events (attestation_id, user_id, event_kind, detail)
    VALUES (NEW.id, NEW.attested_by_user_id, 'invalidated', jsonb_build_object('reason', NEW.invalidated_reason));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cv_claim_attestation_after_write ON public.cv_claim_attestations;
CREATE TRIGGER cv_claim_attestation_after_write
AFTER INSERT OR UPDATE ON public.cv_claim_attestations
FOR EACH ROW EXECUTE FUNCTION public.cv_claim_attestation_after_write();

CREATE OR REPLACE FUNCTION public.cv_claim_invalidate_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.cv_claim_attestations a
     SET invalidated_at = now(), invalidated_reason = 'claim_text_changed'
   WHERE a.document_id = NEW.document_id
     AND a.claim_id = NEW.claim_id
     AND a.withdrawn_at IS NULL
     AND a.invalidated_at IS NULL
     AND a.attested_claim_hash <> md5(btrim(NEW.value));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cv_claim_invalidate_attestation ON public.cv_document_claims;
CREATE TRIGGER cv_claim_invalidate_attestation
AFTER INSERT OR UPDATE OF value ON public.cv_document_claims
FOR EACH ROW EXECUTE FUNCTION public.cv_claim_invalidate_attestation();

ALTER TABLE ai.model_runs
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS cost_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;

INSERT INTO ai.model_pricing (model_id, currency, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, valid_from)
SELECT v.model_id, 'USD', v.inp, v.outp, v.cr, v.cw, timestamptz '2026-01-01 00:00:00+00'
  FROM (VALUES
    ('claude-sonnet-5', 3.00, 15.00, 0.30, 3.75),
    ('claude-sonnet-4-6', 3.00, 15.00, 0.30, 3.75),
    ('claude-haiku-4-5-20251001', 1.00, 5.00, 0.10, 1.25)
  ) AS v(model_id, inp, outp, cr, cw)
 WHERE NOT EXISTS (SELECT 1 FROM ai.model_pricing p WHERE p.model_id = v.model_id AND p.valid_to IS NULL);

CREATE OR REPLACE FUNCTION ai.model_run_cost(
  p_model_id text, p_at timestamptz,
  p_in integer, p_out integer, p_cache_read integer, p_cache_write integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ai, public AS $$
DECLARE r ai.model_pricing%ROWTYPE; v_cost numeric;
BEGIN
  SELECT * INTO r FROM ai.model_pricing
   WHERE model_id = p_model_id
     AND valid_from <= COALESCE(p_at, now())
     AND (valid_to IS NULL OR valid_to > COALESCE(p_at, now()))
   ORDER BY valid_from DESC LIMIT 1;
  IF r.id IS NULL OR p_in IS NULL OR p_out IS NULL THEN
    RETURN jsonb_build_object('cost_complete', false, 'estimated_cost_usd', NULL, 'pricing_snapshot', NULL);
  END IF;
  v_cost := (p_in::numeric / 1000000) * r.input_per_mtok
          + (p_out::numeric / 1000000) * r.output_per_mtok
          + (COALESCE(p_cache_read,0)::numeric / 1000000) * COALESCE(r.cache_read_per_mtok,0)
          + (COALESCE(p_cache_write,0)::numeric / 1000000) * COALESCE(r.cache_write_per_mtok,0);
  RETURN jsonb_build_object(
    'cost_complete', true,
    'estimated_cost_usd', round(v_cost, 6),
    'pricing_snapshot', jsonb_build_object(
      'pricing_id', r.id, 'model_id', r.model_id, 'currency', r.currency,
      'input_per_mtok', r.input_per_mtok, 'output_per_mtok', r.output_per_mtok,
      'cache_read_per_mtok', r.cache_read_per_mtok, 'cache_write_per_mtok', r.cache_write_per_mtok,
      'valid_from', r.valid_from));
END $$;

CREATE OR REPLACE FUNCTION public.internal_ai_finish_model_run(
  p_model_run_id uuid, p_status text, p_outcome text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text,
  p_http_status integer DEFAULT NULL::integer, p_request_id text DEFAULT NULL::text, p_duration_ms integer DEFAULT NULL::integer,
  p_retry_count integer DEFAULT 0, p_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v ai.model_runs%ROWTYPE; c jsonb;
BEGIN
  UPDATE ai.model_runs
     SET status = p_status, outcome = p_outcome, error_code = p_error_code,
         http_status = p_http_status, request_id = p_request_id,
         duration_ms = p_duration_ms, retry_count = COALESCE(p_retry_count, 0),
         input_tokens = p_input_tokens, output_tokens = p_output_tokens,
         finished_at = pg_catalog.now()
   WHERE id = p_model_run_id
   RETURNING * INTO v;
  IF v.id IS NULL THEN RETURN; END IF;
  c := ai.model_run_cost(v.model_id, v.started_at, v.input_tokens, v.output_tokens,
                         v.cache_read_tokens, v.cache_write_tokens);
  UPDATE ai.model_runs
     SET estimated_cost_usd = NULLIF(c->>'estimated_cost_usd','')::numeric,
         cost_complete = (c->>'cost_complete')::boolean,
         pricing_snapshot = c->'pricing_snapshot'
   WHERE id = p_model_run_id;
END $$;

UPDATE ai.model_runs r
   SET estimated_cost_usd = NULLIF(ai.model_run_cost(r.model_id, r.started_at, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)->>'estimated_cost_usd','')::numeric,
       cost_complete = (ai.model_run_cost(r.model_id, r.started_at, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)->>'cost_complete')::boolean,
       pricing_snapshot = ai.model_run_cost(r.model_id, r.started_at, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)->'pricing_snapshot'
 WHERE r.finished_at IS NOT NULL;

DROP FUNCTION IF EXISTS public.internal_ai_generation_commit_step(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,jsonb,uuid,text,text);