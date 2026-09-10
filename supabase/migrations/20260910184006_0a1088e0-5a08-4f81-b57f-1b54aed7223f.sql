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
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
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

  IF v_row.outcome = 'processing' THEN
    UPDATE public.inbound_email_delivery_attempts a
    SET outcome = 'lease_expired', finished_at = now()
    WHERE a.delivery_id = v_row.id
      AND a.attempt_number = v_row.attempt_count
      AND a.outcome = 'processing';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

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

REVOKE ALL ON FUNCTION public.inbound_email_claim_delivery(uuid, uuid, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_email_claim_delivery(uuid, uuid, text, text, text, text, integer, integer) TO service_role;