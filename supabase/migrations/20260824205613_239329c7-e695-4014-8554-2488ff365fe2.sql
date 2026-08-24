-- Careerjet-arkivopprydding: 60 dagers oppbevaring fra publiseringsdato.
-- NAV er eksplisitt unntatt: NAV-annonser beholdes og markeres kun som expired av synk.
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
  v_threads uuid[];
  v_postings uuid[];
  v_deleted_postings integer := 0;
  v_deleted_threads integer := 0;
  v_deleted_canonicals integer := 0;
BEGIN
  -- Hele identitetstråder ryddes samlet: en tråd fjernes bare når samtlige
  -- annonser i den er Careerjet og eldre enn grensen.
  SELECT coalesce(array_agg(t.id), '{}')
    INTO v_threads
  FROM (
    SELECT th.id
    FROM public.careerjet_source_threads th
    WHERE NOT EXISTS (
      SELECT 1 FROM public.source_postings sp
      WHERE sp.identity_thread_id = th.id
        AND (sp.source <> 'careerjet' OR sp.published_at IS NULL OR sp.published_at >= v_cutoff)
    )
    LIMIT greatest(p_batch, 1)
  ) t;

  SELECT coalesce(array_agg(id), '{}')
    INTO v_postings
  FROM (
    SELECT sp.id
    FROM public.source_postings sp
    WHERE sp.source = 'careerjet'
      AND sp.published_at IS NOT NULL
      AND sp.published_at < v_cutoff
      AND (
        sp.identity_thread_id = ANY (v_threads)
        OR sp.identity_thread_id IS NULL
      )
    LIMIT greatest(p_batch, 1) * 4
  ) s;

  IF array_length(v_postings, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'cutoff', v_cutoff, 'deleted_postings', 0,
      'deleted_threads', 0, 'deleted_canonicals', 0
    );
  END IF;

  -- Løsne RESTRICT-referanser fra rader som blir stående igjen.
  UPDATE public.source_postings
     SET identity_superseded_by_source_posting_id = NULL
   WHERE identity_superseded_by_source_posting_id = ANY (v_postings)
     AND NOT (id = ANY (v_postings));

  DELETE FROM public.careerjet_identity_audit
   WHERE source_posting_id = ANY (v_postings)
      OR thread_id = ANY (v_threads);

  DELETE FROM public.careerjet_identity_review_candidates
   WHERE source_posting_id = ANY (v_postings);

  DELETE FROM public.careerjet_identity_review
   WHERE thread_id = ANY (v_threads);

  DELETE FROM public.careerjet_source_observations
   WHERE thread_id = ANY (v_threads);

  -- opportunity_source_links har ON DELETE CASCADE mot source_postings.
  DELETE FROM public.source_postings WHERE id = ANY (v_postings);
  GET DIAGNOSTICS v_deleted_postings = ROW_COUNT;

  DELETE FROM public.careerjet_source_threads th
   WHERE th.id = ANY (v_threads)
     AND NOT EXISTS (SELECT 1 FROM public.source_postings sp WHERE sp.identity_thread_id = th.id);
  GET DIAGNOSTICS v_deleted_threads = ROW_COUNT;

  -- Muligheter uten gjenværende kilde har ingen verdi; user_opportunities,
  -- match_assessments og requirement-atomer henger på med CASCADE.
  DELETE FROM public.canonical_opportunities co
   WHERE NOT EXISTS (
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

-- Nattlig opprydding i porsjoner.
SELECT cron.unschedule('careerjet-purge-60d')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'careerjet-purge-60d');

SELECT cron.schedule(
  'careerjet-purge-60d',
  '20 3 * * *',
  $cron$ SELECT public.careerjet_purge_old_postings(60, 5000); $cron$
);