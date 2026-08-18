-- 1) Forslag som peker på funn brukeren allerede har bekreftet i gjennomgangen
UPDATE public.atom_enrichment_proposals p
   SET status = 'superseded',
       reviewer_comment = COALESCE(p.reviewer_comment, 'Allerede bekreftet i CV-gjennomgangen'),
       updated_at = now()
  FROM public.cv_parse_candidates c
 WHERE p.status IN ('pending_review','needs_more_context')
   AND c.id = NULLIF(p.proposal_payload->'structured_data'->>'parse_candidate_id','')::uuid
   AND c.user_id = p.user_id
   AND c.promoted_atom_id IS NOT NULL;

-- 2) Dobbeltoppførte forslag fra flere analysekjøringer: behold nyeste
WITH ranked AS (
  SELECT p.id,
         row_number() OVER (
           PARTITION BY p.user_id,
                        p.proposal_payload->'structured_data'->>'source_hash',
                        p.proposal_payload->>'atom_type',
                        p.proposal_action
           ORDER BY p.created_at DESC, p.id DESC
         ) AS rn
    FROM public.atom_enrichment_proposals p
   WHERE p.status IN ('pending_review','needs_more_context')
     AND COALESCE(p.proposal_payload->'structured_data'->>'source_hash','') <> ''
)
UPDATE public.atom_enrichment_proposals p
   SET status = 'superseded',
       reviewer_comment = COALESCE(p.reviewer_comment, 'Erstattet av nyere forslag fra samme funn'),
       updated_at = now()
  FROM ranked r
 WHERE r.id = p.id AND r.rn > 1;