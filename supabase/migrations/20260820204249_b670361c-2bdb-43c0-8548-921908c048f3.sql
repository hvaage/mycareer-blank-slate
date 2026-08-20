-- Backoff: 1, 5, 15, 60 minutter
CREATE OR REPLACE FUNCTION public._linkedin_import_backoff(p_retry_count integer)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_retry_count
    WHEN 0 THEN interval '1 minute'
    WHEN 1 THEN interval '5 minutes'
    WHEN 2 THEN interval '15 minutes'
    ELSE interval '60 minutes'
  END;
$$;

CREATE OR REPLACE FUNCTION public._linkedin_import_notify(
  p_user_id uuid, p_import_id uuid, p_attempt_id uuid, p_kind text,
  p_title text, p_body text, p_deep_link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_notifications
    (user_id, notification_kind, linkedin_import_id, attempt_id, title, body, deep_link)
  VALUES (p_user_id, p_kind, p_import_id, p_attempt_id, p_title, p_body, p_deep_link)
  ON CONFLICT (user_id, linkedin_import_id, notification_kind)
    WHERE linkedin_import_id IS NOT NULL DO NOTHING;
$$;

-- Videreføringsregel: et avsluttet forsøk etterlater aldri importen uten arbeid.
CREATE OR REPLACE FUNCTION public._linkedin_import_continue(
  p_attempt public.linkedin_import_attempts, p_error_code text, p_error_summary text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_id uuid;
BEGIN
  IF p_attempt.retry_count + 1 >= p_attempt.max_attempts THEN
    UPDATE public.linkedin_imports
       SET status = 'failed', error_code = p_error_code, error_summary = p_error_summary,
           active_phase = NULL, heartbeat_at = NULL, last_attempt_id = p_attempt.id
     WHERE id = p_attempt.linkedin_import_id;

    PERFORM public._linkedin_import_notify(
      p_attempt.user_id, p_attempt.linkedin_import_id, p_attempt.id, 'import_failed_terminal',
      'LinkedIn-importen kunne ikke fullføres',
      'Importen ble avbrutt etter flere forsøk (' || coalesce(p_error_code, 'ukjent_feil') || '). Du kan starte et nytt forsøk.',
      '/kilder?import=' || p_attempt.linkedin_import_id::text);
    RETURN NULL;
  END IF;

  INSERT INTO public.linkedin_import_attempts (
    user_id, linkedin_import_id, attempt_number, status, phase, cursor_json,
    next_retry_at, retry_count, max_attempts,
    processed_files_count, processed_rows_count, staged_records_count,
    reconciliation_runs_count, warning_count)
  VALUES (
    p_attempt.user_id, p_attempt.linkedin_import_id, p_attempt.attempt_number + 1, 'queued', 'queued',
    p_attempt.cursor_json,
    now() + public._linkedin_import_backoff(p_attempt.retry_count),
    p_attempt.retry_count + 1, p_attempt.max_attempts,
    p_attempt.processed_files_count, p_attempt.processed_rows_count, p_attempt.staged_records_count,
    p_attempt.reconciliation_runs_count, p_attempt.warning_count)
  RETURNING id INTO v_new_id;

  UPDATE public.linkedin_imports
     SET last_attempt_id = v_new_id, active_phase = NULL, heartbeat_at = NULL,
         error_code = p_error_code
   WHERE id = p_attempt.linkedin_import_id;

  RETURN v_new_id;
END;
$$;

-- Legg en import i kø (første forsøk).
CREATE OR REPLACE FUNCTION public.linkedin_import_enqueue(p_import_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_imp public.linkedin_imports;
  v_id uuid;
  v_next integer;
BEGIN
  SELECT * INTO v_imp FROM public.linkedin_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found'; END IF;
  IF v_imp.archive_storage_path IS NULL OR v_imp.archive_available = false THEN
    RAISE EXCEPTION 'archive_not_available';
  END IF;

  SELECT id INTO v_id FROM public.linkedin_import_attempts
   WHERE linkedin_import_id = p_import_id AND status IN ('queued','running') LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO v_next
    FROM public.linkedin_import_attempts WHERE linkedin_import_id = p_import_id;

  INSERT INTO public.linkedin_import_attempts (user_id, linkedin_import_id, attempt_number)
  VALUES (v_imp.user_id, p_import_id, v_next)
  RETURNING id INTO v_id;

  UPDATE public.linkedin_imports
     SET status = 'uploaded', last_attempt_id = v_id, error_code = NULL, error_summary = NULL,
         active_phase = NULL, heartbeat_at = NULL, cancelled_at = NULL
   WHERE id = p_import_id;
  RETURN v_id;
END;
$$;

-- Atomisk claim av neste modne jobb.
CREATE OR REPLACE FUNCTION public.linkedin_import_claim_next_attempt(
  p_lease_owner text, p_lease_seconds integer DEFAULT 180)
RETURNS TABLE (
  attempt_id uuid, import_id uuid, user_id uuid, attempt_number integer,
  phase text, cursor_json jsonb, retry_count integer,
  archive_storage_path text, purposes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM public.linkedin_import_attempts a
    JOIN public.linkedin_imports i ON i.id = a.linkedin_import_id
   WHERE a.status = 'queued'
     AND a.next_retry_at <= now()
     AND a.cancellation_requested_at IS NULL
     AND i.purged_at IS NULL
   ORDER BY a.next_retry_at
   FOR UPDATE OF a SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE public.linkedin_import_attempts a
     SET status = 'running', phase = CASE WHEN a.phase = 'queued' THEN 'validating_archive' ELSE a.phase END,
         lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(),
         started_at = coalesce(a.started_at, now())
   WHERE a.id = v_id;

  UPDATE public.linkedin_imports i
     SET status = CASE WHEN i.status IN ('uploaded','failed') THEN 'validating' ELSE i.status END,
         active_phase = 'validation', heartbeat_at = now(), last_attempt_id = v_id,
         staging_started_at = coalesce(i.staging_started_at, now())
   WHERE i.id = (SELECT linkedin_import_id FROM public.linkedin_import_attempts WHERE id = v_id);

  RETURN QUERY
  SELECT a.id, a.linkedin_import_id, a.user_id, a.attempt_number, a.phase, a.cursor_json,
         a.retry_count, i.archive_storage_path,
         coalesce((SELECT array_agg(p.purpose::text) FROM public.linkedin_import_purposes p
                    WHERE p.linkedin_import_id = i.id), ARRAY[]::text[])
    FROM public.linkedin_import_attempts a
    JOIN public.linkedin_imports i ON i.id = a.linkedin_import_id
   WHERE a.id = v_id;
END;
$$;

-- Hjerteslag + fremdrift. Returnerer false hvis jobben skal stoppe.
CREATE OR REPLACE FUNCTION public.linkedin_import_heartbeat(
  p_attempt_id uuid, p_lease_owner text, p_phase text DEFAULT NULL,
  p_cursor jsonb DEFAULT NULL, p_processed_files integer DEFAULT NULL,
  p_processed_rows integer DEFAULT NULL, p_staged_records integer DEFAULT NULL,
  p_lease_seconds integer DEFAULT 180)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  UPDATE public.linkedin_import_attempts a
     SET heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         phase = coalesce(p_phase, a.phase),
         cursor_json = coalesce(p_cursor, a.cursor_json),
         processed_files_count = coalesce(p_processed_files, a.processed_files_count),
         processed_rows_count = coalesce(p_processed_rows, a.processed_rows_count),
         staged_records_count = coalesce(p_staged_records, a.staged_records_count)
   WHERE a.id = p_attempt_id AND a.status = 'running' AND a.lease_owner = p_lease_owner
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.linkedin_imports
     SET heartbeat_at = now(),
         active_phase = v_row.phase,
         status = CASE v_row.phase
                    WHEN 'validating_archive' THEN 'validating'
                    WHEN 'staging' THEN 'staging'
                    WHEN 'reconciling' THEN 'staged'
                    ELSE status END
   WHERE id = v_row.linkedin_import_id;

  RETURN v_row.cancellation_requested_at IS NULL;
END;
$$;

-- Terminal suksess / delvis suksess / avbrudd.
CREATE OR REPLACE FUNCTION public.linkedin_import_complete_attempt(
  p_attempt_id uuid, p_status text, p_warning_count integer DEFAULT 0,
  p_staged_records integer DEFAULT NULL, p_reconciliation_runs integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  IF p_status NOT IN ('succeeded','partially_succeeded','cancelled') THEN
    RAISE EXCEPTION 'invalid_terminal_status';
  END IF;

  UPDATE public.linkedin_import_attempts a
     SET status = p_status, phase = 'finalizing', finished_at = now(),
         lease_owner = NULL, lease_expires_at = NULL,
         warning_count = coalesce(p_warning_count, a.warning_count),
         staged_records_count = coalesce(p_staged_records, a.staged_records_count),
         reconciliation_runs_count = coalesce(p_reconciliation_runs, a.reconciliation_runs_count)
   WHERE a.id = p_attempt_id AND a.status = 'running'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.linkedin_imports
     SET status = CASE WHEN p_status = 'cancelled' THEN 'cancelled' ELSE 'reconciliation_ready' END,
         active_phase = NULL, heartbeat_at = NULL, last_attempt_id = v_row.id,
         cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END,
         staged_at = CASE WHEN p_status = 'cancelled' THEN staged_at ELSE now() END
   WHERE id = v_row.linkedin_import_id;

  IF p_status = 'succeeded' THEN
    PERFORM public._linkedin_import_notify(
      v_row.user_id, v_row.linkedin_import_id, v_row.id, 'import_completed',
      'LinkedIn-importen er ferdig',
      'Vi leste ' || v_row.staged_records_count || ' rader. Ingenting er lagt til i karriereoversikten før du godkjenner forslagene.',
      '/kildegjennomgang?source=linkedin&import=' || v_row.linkedin_import_id::text);
  ELSIF p_status = 'partially_succeeded' THEN
    PERFORM public._linkedin_import_notify(
      v_row.user_id, v_row.linkedin_import_id, v_row.id, 'import_partially_completed',
      'LinkedIn-importen er delvis ferdig',
      'Noen kilder kunne ikke leses, men resten er klar til gjennomgang.',
      '/kildegjennomgang?source=linkedin&import=' || v_row.linkedin_import_id::text);
  END IF;
END;
$$;

-- Feilet forsøk: alltid videreføring eller terminal feil.
CREATE OR REPLACE FUNCTION public.linkedin_import_fail_attempt(
  p_attempt_id uuid, p_error_code text, p_error_summary text, p_retryable boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  UPDATE public.linkedin_import_attempts a
     SET status = 'failed', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL,
         error_code = p_error_code, error_summary = left(coalesce(p_error_summary, ''), 500)
   WHERE a.id = p_attempt_id AND a.status IN ('running','queued')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_retryable THEN
    RETURN public._linkedin_import_continue(v_row, p_error_code, p_error_summary);
  END IF;

  UPDATE public.linkedin_imports
     SET status = 'failed', error_code = p_error_code,
         error_summary = left(coalesce(p_error_summary, ''), 500),
         active_phase = NULL, heartbeat_at = NULL, last_attempt_id = v_row.id
   WHERE id = v_row.linkedin_import_id;

  PERFORM public._linkedin_import_notify(
    v_row.user_id, v_row.linkedin_import_id, v_row.id, 'import_failed_terminal',
    'LinkedIn-importen kunne ikke fullføres',
    'Importen stoppet (' || coalesce(p_error_code, 'ukjent_feil') || '). Last ned en ny eksport og prøv igjen.',
    '/kilder?import=' || v_row.linkedin_import_id::text);
  RETURN NULL;
END;
$$;

-- Reaper: utløpt lease -> expired + nytt forsøk, eller terminal feil.
CREATE OR REPLACE FUNCTION public.linkedin_import_reap_expired_attempts(p_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.linkedin_import_attempts
     WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
     ORDER BY lease_expires_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  LOOP
    UPDATE public.linkedin_import_attempts
       SET status = 'expired', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL,
           error_code = 'lease_expired', error_summary = 'Arbeideren mistet kontakten.'
     WHERE id = v_row.id;

    PERFORM public._linkedin_import_continue(v_row, 'lease_expired', 'Arbeideren mistet kontakten.');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Brukerstyrt avbrudd (kalles kun fra serverrute etter eierkontroll).
CREATE OR REPLACE FUNCTION public.linkedin_import_request_cancel(p_import_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  SELECT * INTO v_row FROM public.linkedin_import_attempts
   WHERE linkedin_import_id = p_import_id AND user_id = p_user_id
     AND status IN ('queued','running')
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_active_attempt'; END IF;

  IF v_row.status = 'queued' THEN
    UPDATE public.linkedin_import_attempts
       SET status = 'cancelled', cancellation_requested_at = now(), finished_at = now()
     WHERE id = v_row.id;
    UPDATE public.linkedin_imports
       SET status = 'cancelled', cancelled_at = now(), active_phase = NULL, heartbeat_at = NULL
     WHERE id = p_import_id;
    RETURN 'cancelled';
  END IF;

  UPDATE public.linkedin_import_attempts
     SET cancellation_requested_at = now()
   WHERE id = v_row.id;
  RETURN 'cancellation_requested';
END;
$$;

-- Manuelt nytt forsøk: bevarer historikk, starter fra begynnelsen av køen.
CREATE OR REPLACE FUNCTION public.linkedin_import_manual_retry(p_import_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_imp public.linkedin_imports;
  v_next integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_imp FROM public.linkedin_imports
   WHERE id = p_import_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found'; END IF;
  IF v_imp.archive_storage_path IS NULL OR v_imp.archive_available = false THEN
    RAISE EXCEPTION 'archive_not_available';
  END IF;

  SELECT id INTO v_id FROM public.linkedin_import_attempts
   WHERE linkedin_import_id = p_import_id AND status IN ('queued','running') LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO v_next
    FROM public.linkedin_import_attempts WHERE linkedin_import_id = p_import_id;

  INSERT INTO public.linkedin_import_attempts
    (user_id, linkedin_import_id, attempt_number, retry_count, cursor_json)
  VALUES (p_user_id, p_import_id, v_next, 0,
    coalesce((SELECT cursor_json FROM public.linkedin_import_attempts
               WHERE linkedin_import_id = p_import_id ORDER BY attempt_number DESC LIMIT 1), '{}'::jsonb))
  RETURNING id INTO v_id;

  UPDATE public.linkedin_imports
     SET status = 'uploaded', error_code = NULL, error_summary = NULL,
         active_phase = NULL, heartbeat_at = NULL, cancelled_at = NULL, last_attempt_id = v_id
   WHERE id = p_import_id;
  RETURN v_id;
END;
$$;

-- Kun serverrollen kan kalle driftsfunksjonene.
REVOKE ALL ON FUNCTION public._linkedin_import_backoff(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._linkedin_import_notify(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._linkedin_import_continue(public.linkedin_import_attempts,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_enqueue(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_claim_next_attempt(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_heartbeat(uuid,text,text,jsonb,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_complete_attempt(uuid,text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_fail_attempt(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_reap_expired_attempts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_request_cancel(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_import_manual_retry(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.linkedin_import_enqueue(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_claim_next_attempt(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_heartbeat(uuid,text,text,jsonb,integer,integer,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_complete_attempt(uuid,text,integer,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_fail_attempt(uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_reap_expired_attempts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_request_cancel(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_import_manual_retry(uuid,uuid) TO service_role;
