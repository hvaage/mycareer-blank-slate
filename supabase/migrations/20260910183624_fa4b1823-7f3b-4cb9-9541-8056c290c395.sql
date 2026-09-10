-- 1. Delivery lifecycle columns (additive)
ALTER TABLE public.inbound_email_deliveries
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

ALTER TABLE public.inbound_email_deliveries
  DROP CONSTRAINT IF EXISTS inbound_email_deliveries_outcome_check;

ALTER TABLE public.inbound_email_deliveries
  ADD CONSTRAINT inbound_email_deliveries_outcome_check
  CHECK (outcome = ANY (ARRAY['processing','accepted','duplicate','parse_failed','ingest_failed']));

-- processing is the ONLY active lease state and must always carry a lease.
ALTER TABLE public.inbound_email_deliveries
  ADD CONSTRAINT inbound_email_deliveries_lease_check
  CHECK (
    (outcome = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (outcome <> 'processing')
  );

-- 2. Append-only attempt audit trail
CREATE TABLE IF NOT EXISTS public.inbound_email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.inbound_email_deliveries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  outcome text NOT NULL CHECK (outcome = ANY (ARRAY['processing','accepted','parse_failed','ingest_failed','lease_expired'])),
  reject_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_number)
);

GRANT SELECT ON public.inbound_email_delivery_attempts TO authenticated;
GRANT ALL ON public.inbound_email_delivery_attempts TO service_role;

ALTER TABLE public.inbound_email_delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own delivery attempts" ON public.inbound_email_delivery_attempts;
CREATE POLICY "Users can read their own delivery attempts"
  ON public.inbound_email_delivery_attempts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS inbound_email_delivery_attempts_delivery_idx
  ON public.inbound_email_delivery_attempts (delivery_id, attempt_number DESC);

DROP TRIGGER IF EXISTS update_inbound_email_delivery_attempts_updated_at
  ON public.inbound_email_delivery_attempts;
CREATE TRIGGER update_inbound_email_delivery_attempts_updated_at
BEFORE UPDATE ON public.inbound_email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Database-enforced import identity (closes the crash window)
CREATE UNIQUE INDEX IF NOT EXISTS imported_job_emails_source_message_idx
  ON public.imported_job_emails (email_job_source_id, provider_message_id)
  WHERE email_job_source_id IS NOT NULL AND provider_message_id IS NOT NULL;

-- 4. Atomic claim
CREATE OR REPLACE FUNCTION public.inbound_email_claim_delivery(
  p_user_id uuid,
  p_email_job_source_id uuid,
  p_alias_token text,
  p_provider text,
  p_provider_message_id text,
  p_from_domain text DEFAULT NULL,
  p_size_bytes integer DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (status text, delivery_id uuid, claim_token text, attempt_number integer, imported_job_email_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lock_key bigint;
  v_row public.inbound_email_deliveries%ROWTYPE;
  v_token text;
  v_lease integer := GREATEST(COALESCE(p_lease_seconds, 300), 30);
BEGIN
  v_lock_key := hashtextextended(p_email_job_source_id::text || '|' || p_provider || '|' || p_provider_message_id, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row
  FROM public.inbound_email_deliveries d
  WHERE d.email_job_source_id = p_email_job_source_id
    AND d.provider = p_provider
    AND d.provider_message_id = p_provider_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_token := encode(gen_random_bytes(24), 'hex');
    INSERT INTO public.inbound_email_deliveries (
      user_id, email_job_source_id, provider, provider_message_id, alias_token,
      from_domain, size_bytes, outcome, claim_token, lease_expires_at,
      attempt_count, last_attempt_at
    ) VALUES (
      p_user_id, p_email_job_source_id, p_provider, p_provider_message_id, p_alias_token,
      p_from_domain, p_size_bytes, 'processing', v_token, now() + make_interval(secs => v_lease),
      1, now()
    )
    RETURNING * INTO v_row;

    INSERT INTO public.inbound_email_delivery_attempts (delivery_id, user_id, attempt_number, outcome)
    VALUES (v_row.id, v_row.user_id, 1, 'processing');

    RETURN QUERY SELECT 'claimed'::text, v_row.id, v_token, 1, NULL::uuid;
    RETURN;
  END IF;

  IF v_row.outcome = 'accepted' THEN
    RETURN QUERY SELECT 'duplicate'::text, v_row.id, NULL::text, v_row.attempt_count, v_row.imported_job_email_id;
    RETURN;
  END IF;

  IF v_row.outcome = 'processing' AND v_row.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'in_progress'::text, v_row.id, NULL::text, v_row.attempt_count, NULL::uuid;
    RETURN;
  END IF;

  -- Expired lease: record the abandoned attempt before handing the work over.
  IF v_row.outcome = 'processing' THEN
    UPDATE public.inbound_email_delivery_attempts a
    SET outcome = 'lease_expired', finished_at = now()
    WHERE a.delivery_id = v_row.id
      AND a.attempt_number = v_row.attempt_count
      AND a.outcome = 'processing';
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  UPDATE public.inbound_email_deliveries d
  SET outcome = 'processing',
      claim_token = v_token,
      lease_expires_at = now() + make_interval(secs => v_lease),
      attempt_count = d.attempt_count + 1,
      last_attempt_at = now(),
      reject_reason = NULL,
      alias_token = p_alias_token,
      from_domain = COALESCE(p_from_domain, d.from_domain),
      size_bytes = COALESCE(p_size_bytes, d.size_bytes),
      updated_at = now()
  WHERE d.id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.inbound_email_delivery_attempts (delivery_id, user_id, attempt_number, outcome)
  VALUES (v_row.id, v_row.user_id, v_row.attempt_count, 'processing');

  RETURN QUERY SELECT 'claimed'::text, v_row.id, v_token, v_row.attempt_count, v_row.imported_job_email_id;
END;
$$;

-- 5. Atomic finalize, only by the current lease holder
CREATE OR REPLACE FUNCTION public.inbound_email_finalize_delivery(
  p_delivery_id uuid,
  p_claim_token text,
  p_outcome text,
  p_reject_reason text DEFAULT NULL,
  p_imported_job_email_id uuid DEFAULT NULL
)
RETURNS TABLE (status text, outcome text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.inbound_email_deliveries%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('accepted','parse_failed','ingest_failed') THEN
    RAISE EXCEPTION 'invalid terminal outcome: %', p_outcome;
  END IF;

  SELECT * INTO v_row
  FROM public.inbound_email_deliveries d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text;
    RETURN;
  END IF;

  IF v_row.outcome <> 'processing'
     OR v_row.claim_token IS NULL
     OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT 'lease_lost'::text, v_row.outcome;
    RETURN;
  END IF;

  UPDATE public.inbound_email_deliveries d
  SET outcome = p_outcome,
      reject_reason = p_reject_reason,
      imported_job_email_id = COALESCE(p_imported_job_email_id, d.imported_job_email_id),
      claim_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE d.id = v_row.id;

  UPDATE public.inbound_email_delivery_attempts a
  SET outcome = p_outcome, reject_reason = p_reject_reason, finished_at = now()
  WHERE a.delivery_id = v_row.id
    AND a.attempt_number = v_row.attempt_count;

  RETURN QUERY SELECT 'finalized'::text, p_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.inbound_email_claim_delivery(uuid, uuid, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inbound_email_finalize_delivery(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_email_claim_delivery(uuid, uuid, text, text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.inbound_email_finalize_delivery(uuid, text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.inbound_email_claim_delivery(uuid, uuid, text, text, text, text, integer, integer) IS
  'Atomically claims one inbound delivery. processing is the only active lease state; accepted is terminal. Retries are allowed after parse_failed, ingest_failed or an expired lease.';
COMMENT ON FUNCTION public.inbound_email_finalize_delivery(uuid, text, text, text, uuid) IS
  'Finalizes a delivery only for the current lease holder (claim token match).';