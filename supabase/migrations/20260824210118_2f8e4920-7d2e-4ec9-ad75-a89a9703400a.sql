CREATE OR REPLACE FUNCTION public.careerjet_purge_old_postings(
  p_days integer DEFAULT 60,
  p_batch integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_postings uuid[];
  v_threads uuid[];
  v_canonicals uuid[];
  v_deleted_postings integer := 0;
  v_deleted_threads integer := 0;
  v_deleted_canonicals integer := 0;
BEGIN
  SELECT coalesce(array_agg(id), '{}')
    INTO v_postings
  FROM (
    SELECT sp.id
    FROM public.source_postings sp
    WHERE sp.source = 'careerjet'
      AND sp.published_at IS NOT NULL
      AND sp.published_at < v_cutoff
    ORDER BY sp.published_at
    LIMIT greatest(p_batch, 1)
  ) s;

  IF array_length(v_postings, 1) IS NULL THEN
    RETURN jsonb_build_object('cutoff', v_cutoff, 'deleted_postings', 0,
                              'deleted_threads', 0, 'deleted_canonicals', 0);
  END IF;

  SELECT coalesce(array_agg(DISTINCT l.canonical_opportunity_id), '{}')
    INTO v_canonicals
  FROM public.opportunity_source_links l
  WHERE l.source_posting_id = ANY (v_postings);

  SELECT coalesce(array_agg(DISTINCT sp.identity_thread_id), '{}')
    INTO v_threads
  FROM public.source_postings sp
  WHERE sp.id = ANY (v_postings)
    AND sp.identity_thread_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.source_postings o
      WHERE o.identity_thread_id = sp.identity_thread_id
        AND NOT (o.id = ANY (v_postings))
    );

  -- Tråder som blir stående og peker på en annonse i porsjonen får ny hovedannonse.
  UPDATE public.careerjet_source_threads th
     SET keeper_source_posting_id = (
       SELECT sp.id FROM public.source_postings sp
        WHERE sp.identity_thread_id = th.id
          AND NOT (sp.id = ANY (v_postings))
        ORDER BY sp.published_at DESC NULLS LAST
        LIMIT 1
     ),
     updated_at = now()
   WHERE th.keeper_source_posting_id = ANY (v_postings)
     AND NOT (th.id = ANY (v_threads));

  UPDATE public.source_postings
     SET identity_superseded_by_source_posting_id = NULL
   WHERE identity_superseded_by_source_posting_id = ANY (v_postings)
     AND NOT (id = ANY (v_postings));

  DELETE FROM public.careerjet_identity_audit
   WHERE source_posting_id = ANY (v_postings) OR thread_id = ANY (v_threads);

  DELETE FROM public.careerjet_identity_review_candidates
   WHERE source_posting_id = ANY (v_postings);

  DELETE FROM public.careerjet_identity_review WHERE thread_id = ANY (v_threads);

  DELETE FROM public.careerjet_source_observations WHERE thread_id = ANY (v_threads);

  -- Løsne trådkoblingen først, slik at trådene kan fjernes før annonsene.
  UPDATE public.source_postings
     SET identity_thread_id = NULL
   WHERE id = ANY (v_postings)
     AND identity_thread_id = ANY (v_threads);

  DELETE FROM public.careerjet_source_threads th
   WHERE th.id = ANY (v_threads)
     AND NOT EXISTS (SELECT 1 FROM public.source_postings sp WHERE sp.identity_thread_id = th.id);
  GET DIAGNOSTICS v_deleted_threads = ROW_COUNT;

  DELETE FROM public.source_postings WHERE id = ANY (v_postings);
  GET DIAGNOSTICS v_deleted_postings = ROW_COUNT;

  DELETE FROM public.canonical_opportunities co
   WHERE co.id = ANY (v_canonicals)
     AND NOT EXISTS (
       SELECT 1 FROM public.opportunity_source_links l
        WHERE l.canonical_opportunity_id = co.id
     );
  GET DIAGNOSTICS v_deleted_canonicals = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'deleted_postings', v_deleted_postings,
    'deleted_threads', v_deleted_threads,
    'deleted_canonicals', v_deleted_canonicals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.careerjet_purge_old_postings(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_purge_old_postings(integer, integer) TO service_role, postgres;