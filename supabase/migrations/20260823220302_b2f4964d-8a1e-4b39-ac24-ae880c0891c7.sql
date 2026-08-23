CREATE OR REPLACE FUNCTION public.insert_job_lead_dedup(p_payload jsonb)
RETURNS TABLE (lead_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid := (p_payload->>'user_id')::uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  INSERT INTO public.job_leads (
    user_id, email_connection_id, source_message_id, source_email_from, source_subject,
    received_at, posted_text, title, company, location, work_type, salary_text, job_url,
    raw_snippet, source_system, source_url_hash, source_observed_at, qualification_status,
    qualification_score, qualification_reason, application_due, raw_payload, parse_confidence,
    reject_reason, imported_job_email_id
  )
  VALUES (
    v_user_id,
    NULLIF(p_payload->>'email_connection_id','')::uuid,
    p_payload->>'source_message_id',
    p_payload->>'source_email_from',
    p_payload->>'source_subject',
    NULLIF(p_payload->>'received_at','')::timestamptz,
    p_payload->>'posted_text',
    p_payload->>'title',
    p_payload->>'company',
    p_payload->>'location',
    p_payload->>'work_type',
    p_payload->>'salary_text',
    p_payload->>'job_url',
    p_payload->>'raw_snippet',
    p_payload->>'source_system',
    p_payload->>'source_url_hash',
    NULLIF(p_payload->>'source_observed_at','')::timestamptz,
    p_payload->>'qualification_status',
    NULLIF(p_payload->>'qualification_score','')::smallint,
    p_payload->>'qualification_reason',
    NULLIF(p_payload->>'application_due','')::timestamptz,
    p_payload->'raw_payload',
    NULLIF(p_payload->>'parse_confidence','')::numeric,
    p_payload->>'reject_reason',
    NULLIF(p_payload->>'imported_job_email_id','')::uuid
  )
  ON CONFLICT (user_id, COALESCE(job_url, ''), COALESCE(title, ''), COALESCE(company, '')) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false;
  ELSE
    RETURN QUERY SELECT v_id, true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_job_lead_dedup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_job_lead_dedup(jsonb) TO service_role;