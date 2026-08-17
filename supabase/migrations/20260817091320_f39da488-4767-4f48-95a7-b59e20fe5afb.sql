DO $$
DECLARE u uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
BEGIN
  DELETE FROM public.cv_claim_attestation_events WHERE user_id = u;
  DELETE FROM public.cv_document_claims WHERE user_id = u;
  DELETE FROM public.cv_document_blocks WHERE user_id = u;
  DELETE FROM public.cv_generation_jobs WHERE user_id = u;
  DELETE FROM public.cv_atomization_job_blocks WHERE user_id = u;
  DELETE FROM public.cv_atomization_jobs WHERE user_id = u;
  DELETE FROM public.atom_enrichment_proposals WHERE user_id = u;
  DELETE FROM public.atom_enrichment_batches WHERE user_id = u;
  DELETE FROM public.cv_review_timeline_context WHERE user_id = u;
  DELETE FROM public.cv_review_progress WHERE user_id = u;
  DELETE FROM public.cv_parse_candidates WHERE user_id = u;
  DELETE FROM public.career_atom_links WHERE user_id = u;
  DELETE FROM public.career_atoms WHERE user_id = u;
  DELETE FROM public.cv_imports WHERE user_id = u;
END $$;