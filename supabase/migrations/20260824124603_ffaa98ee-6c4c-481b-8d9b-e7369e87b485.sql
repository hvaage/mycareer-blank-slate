CREATE OR REPLACE FUNCTION public.delete_all_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_excluded text[] := ARRAY[
    'user_roles',                    -- rolletildelinger styres ikke av bruker
    'linkedin_storage_delete_queue', -- driftskø for filopprydding
    'career_skill_source_signals'    -- avledet signaltabell, ryddes av kaskader
  ];
  v_tables text[];
  v_t text;
  v_pending text[];
  v_next text[];
  v_pass int := 0;
  v_deleted jsonb := '{}'::jsonb;
  v_count bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO v_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
   AND a.attname = 'user_id'
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT (c.relname = ANY (v_excluded));

  IF v_tables IS NULL THEN
    RETURN jsonb_build_object('deleted', v_deleted);
  END IF;

  v_pending := v_tables;

  -- Flere passeringer: rader som er beskyttet av fremmednøkler fra andre
  -- brukertabeller slettes når foreldrene/barna er borte.
  WHILE array_length(v_pending, 1) IS NOT NULL AND v_pass < 6 LOOP
    v_pass := v_pass + 1;
    v_next := ARRAY[]::text[];
    FOREACH v_t IN ARRAY v_pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_t) USING v_uid;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_deleted := v_deleted || jsonb_build_object(
          v_t,
          COALESCE((v_deleted ->> v_t)::bigint, 0) + v_count
        );
      EXCEPTION WHEN foreign_key_violation THEN
        v_next := array_append(v_next, v_t);
      END;
    END LOOP;
    EXIT WHEN array_length(v_next, 1) IS NULL;
    EXIT WHEN v_next = v_pending;
    v_pending := v_next;
  END LOOP;

  IF array_length(v_pending, 1) IS NOT NULL AND v_pass >= 1 AND v_next = v_pending THEN
    RAISE EXCEPTION 'Kunne ikke slette alt: %', array_to_string(v_pending, ', ');
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_all_my_data() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_all_my_data() TO authenticated;