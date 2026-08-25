CREATE OR REPLACE FUNCTION public.insert_job_lead_dedup(p_payload jsonb)
RETURNS TABLE (lead_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid := (p_payload->>'user_id')::uuid;
  v_source_system text := p_payload->>'source_system';
  v_source_url_hash text := NULLIF(p_payload->>'source_url_hash','');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  -- 1) URL-basert dedup: job_leads_source_url_hash_idx er en egen UNIQUE-indeks
  --    (user_id, source_system, source_url_hash). Treff her betyr duplikat uavhengig
  --    av hvordan tittel/arbeidsgiver ble parset denne gangen.
  IF v_source_url_hash IS NOT NULL THEN
    SELECT jl.id INTO v_id
    FROM public.job_leads jl
    WHERE jl.user_id = v_user_id
      AND jl.source_system IS NOT DISTINCT FROM v_source_system
      AND jl.source_url_hash = v_source_url_hash
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, false;
      RETURN;
    END IF;
  END IF;

  -- 2) Forsøk innsetting med legacy/fallback-kontrakten som konflikt-arbiter.
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
    v_source_system,
    v_source_url_hash,
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

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  -- 3) Legacy/fallback-konflikt: hent eksisterende rad med nøyaktig samme predikat.
  SELECT jl.id INTO v_id
  FROM public.job_leads jl
  WHERE jl.user_id = v_user_id
    AND COALESCE(jl.job_url,'') = COALESCE(p_payload->>'job_url','')
    AND COALESCE(jl.title,'') = COALESCE(p_payload->>'title','')
    AND COALESCE(jl.company,'') = COALESCE(p_payload->>'company','')
  LIMIT 1;

  RETURN QUERY SELECT v_id, false;
EXCEPTION WHEN unique_violation THEN
  -- Konflikt på source_url_hash-indeksen (f.eks. samme URL importert med litt
  -- annerledes parseresultat). Returner eksisterende rad som duplikat.
  v_id := NULL;
  IF v_source_url_hash IS NOT NULL THEN
    SELECT jl.id INTO v_id
    FROM public.job_leads jl
    WHERE jl.user_id = v_user_id
      AND jl.source_url_hash = v_source_url_hash
    LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    SELECT jl.id INTO v_id
    FROM public.job_leads jl
    WHERE jl.user_id = v_user_id
      AND COALESCE(jl.job_url,'') = COALESCE(p_payload->>'job_url','')
      AND COALESCE(jl.title,'') = COALESCE(p_payload->>'title','')
      AND COALESCE(jl.company,'') = COALESCE(p_payload->>'company','')
    LIMIT 1;
  END IF;
  RETURN QUERY SELECT v_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_job_lead_dedup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_job_lead_dedup(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.insert_job_lead_dedup(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_job_lead_dedup(jsonb) TO service_role;