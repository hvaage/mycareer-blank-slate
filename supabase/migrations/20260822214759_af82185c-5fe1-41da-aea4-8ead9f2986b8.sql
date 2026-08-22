
-- Kanonisk språknøkkel: «English», «Engelsk», «english (native)» -> language:en / Engelsk.
CREATE OR REPLACE FUNCTION public._linkedin_language_canonical(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v text := lower(btrim(coalesce(p_text, '')));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  -- Kutt parenteser og nivåangivelser: "Engelsk (flytende)" -> "engelsk".
  v := btrim(split_part(v, '(', 1));
  v := btrim(split_part(v, ' - ', 1));
  v := regexp_replace(v, '[.,;:]+$', '');

  RETURN CASE
    WHEN v IN ('english','engelsk','eng') THEN jsonb_build_object('key','language:en','label','Engelsk')
    WHEN v IN ('norwegian','norsk','norwegian (bokmål)','norwegian bokmal','bokmål','bokmal','norsk bokmål') THEN jsonb_build_object('key','language:nb','label','Norsk')
    WHEN v IN ('nynorsk','norwegian nynorsk','norsk nynorsk') THEN jsonb_build_object('key','language:nn','label','Nynorsk')
    WHEN v IN ('swedish','svensk','svenska','svensk språk') THEN jsonb_build_object('key','language:sv','label','Svensk')
    WHEN v IN ('danish','dansk') THEN jsonb_build_object('key','language:da','label','Dansk')
    WHEN v IN ('german','tysk','deutsch') THEN jsonb_build_object('key','language:de','label','Tysk')
    WHEN v IN ('french','fransk','français','francais') THEN jsonb_build_object('key','language:fr','label','Fransk')
    WHEN v IN ('spanish','spansk','español','espanol') THEN jsonb_build_object('key','language:es','label','Spansk')
    WHEN v IN ('italian','italiensk','italiano') THEN jsonb_build_object('key','language:it','label','Italiensk')
    WHEN v IN ('dutch','nederlandsk') THEN jsonb_build_object('key','language:nl','label','Nederlandsk')
    WHEN v IN ('polish','polsk','polski') THEN jsonb_build_object('key','language:pl','label','Polsk')
    WHEN v IN ('portuguese','portugisisk') THEN jsonb_build_object('key','language:pt','label','Portugisisk')
    WHEN v IN ('russian','russisk') THEN jsonb_build_object('key','language:ru','label','Russisk')
    WHEN v IN ('finnish','finsk','suomi') THEN jsonb_build_object('key','language:fi','label','Finsk')
    WHEN v IN ('arabic','arabisk') THEN jsonb_build_object('key','language:ar','label','Arabisk')
    WHEN v IN ('chinese','kinesisk','mandarin') THEN jsonb_build_object('key','language:zh','label','Kinesisk')
    WHEN v IN ('japanese','japansk') THEN jsonb_build_object('key','language:ja','label','Japansk')
    ELSE jsonb_build_object('key', 'language:' || regexp_replace(v, '[^a-z0-9]+', '-', 'g'), 'label', initcap(v))
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public._linkedin_language_canonical(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._linkedin_language_canonical(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.linkedin_promote_qualification(p_proposal_id uuid, p_resolution text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_type text;
  v_label text;
  v_canonical jsonb;
  v_key text;
  v_atom_id uuid;
  v_existing uuid;
  v_event uuid;
  v_decision jsonb;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['learning','profile','career']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_type := coalesce(v_payload->>'atom_type', v_payload->>'qualification_kind', 'course');
  v_label := nullif(btrim(coalesce(v_payload->>'title', v_payload->>'name', v_payload->>'label', '')), '');

  IF v_type NOT IN ('education','certification','language','course') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'unsupported_qualification_type', 'retryable', false);
  END IF;

  -- Språk kan komme uten tittelfelt; navnet ligger da i kildesnapshotet.
  IF v_label IS NULL AND v_type = 'language' THEN
    v_label := nullif(btrim(coalesce(
      v_gate->'source_snapshot'->>'name',
      v_gate->'source_snapshot'->>'language',
      v_gate->'source_snapshot'->>'value',
      v_gate->'source_snapshot'->>'title',
      '')), '');
  END IF;

  IF v_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;

  IF p_resolution <> 'create_new' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
  END IF;

  IF v_type = 'language' THEN
    v_canonical := public._linkedin_language_canonical(v_label);
    v_key := v_canonical->>'key';
    v_label := v_canonical->>'label';
    v_payload := v_payload || jsonb_build_object('canonical_key', v_key, 'atom_type', 'language');

    SELECT a.id INTO v_existing
    FROM public.career_atoms a
    WHERE a.user_id = v_user
      AND a.is_active
      AND a.atom_type = 'language'
      AND (
        (a.structured_data->>'canonical_key') = v_key
        OR (public._linkedin_language_canonical(a.content_no)->>'key') = v_key
      )
    LIMIT 1;
  ELSE
    SELECT a.id INTO v_existing
    FROM public.career_atoms a
    WHERE a.user_id = v_user
      AND a.is_active
      AND a.atom_type = v_type
      AND lower(btrim(coalesce(a.content_no, ''))) = lower(v_label)
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    -- Ikke en feil: brukeren har dette fra før. Forslaget avsluttes gjennom
    -- beslutningslaget som «finnes allerede», og ingenting skrives i produktet.
    v_decision := public.linkedin_reconciliation_decide(
      p_proposal_id, 'dismiss', 'already_exists', NULL
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'already_registered',
      'retryable', false,
      'proposal_status', coalesce(v_decision->>'status', 'dismissed'),
      'existing_atom_id', v_existing
    );
  END IF;

  BEGIN
    INSERT INTO public.career_atoms (
      user_id, atom_kind, atom_type, content_no, structured_data,
      source_type, source_ref, confidence, user_confirmed
    )
    VALUES (
      v_user, 'evidens', v_type, v_label, v_payload, 'linkedin_export',
      'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text,
      'imported', false
    )
    RETURNING id INTO v_atom_id;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_qualification', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','career_atom','entity_id',v_atom_id::text,'entity_label',v_label))
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'career_atom_id', v_atom_id);
END;
$function$;
