DO $$
DECLARE
  v_user uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
  v_imports uuid[] := ARRAY['099e4315-8387-4ffd-a22d-89f9f1e5bb1c','1af1cbe7-9d99-40a8-98f6-c09fe271feaf','c0d2da93-13b2-4fa1-8380-59da47a8b7f6','dde8e5d9-b739-4087-b831-f4814a97eaec','627850c9-5ba0-4c4d-a53e-bc6ae876dd2f','d9caf441-3c67-4607-8a01-c11dc99590c7']::uuid[];
  v_docs uuid[] := ARRAY['b9b31785-9b00-4fc2-9022-9764af72886d','4e37b77e-ca89-407d-a4f3-416ceb1d4664']::uuid[];
  v_jobs uuid[] := ARRAY['f503d57c-62b6-4dfb-ba37-62ed01adac8b','55cd080f-8a94-4352-b488-5b6d45efddc5']::uuid[];
  v_atoms uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_atoms FROM public.career_atoms WHERE user_id = v_user;

  DELETE FROM public.cv_claim_attestation_events
   WHERE attestation_id IN (SELECT id FROM public.cv_claim_attestations WHERE document_id = ANY(v_docs));
  DELETE FROM public.cv_claim_attestations WHERE document_id = ANY(v_docs);
  DELETE FROM public.cv_document_claims WHERE document_id = ANY(v_docs);
  DELETE FROM public.cv_document_blocks WHERE document_id = ANY(v_docs);
  DELETE FROM public.case_documents WHERE document_id = ANY(v_docs);
  DELETE FROM public.cv_generation_jobs WHERE id = ANY(v_jobs);

  ALTER TABLE public.documents DROP CONSTRAINT documents_document_group_id_fkey;
  DELETE FROM public.documents WHERE id = ANY(v_docs) AND user_id = v_user;
  ALTER TABLE public.documents
    ADD CONSTRAINT documents_document_group_id_fkey
    FOREIGN KEY (document_group_id) REFERENCES public.documents(id) ON DELETE RESTRICT;

  DELETE FROM public.cv_review_timeline_context WHERE import_id = ANY(v_imports);
  DELETE FROM public.cv_review_progress WHERE import_id = ANY(v_imports);

  IF array_length(v_atoms, 1) IS NOT NULL THEN
    DELETE FROM public.career_atom_evidence_projection
     WHERE atom_id = ANY(v_atoms) OR referenced_atom_id = ANY(v_atoms);
    DELETE FROM public.career_atom_parent_projection
     WHERE atom_id = ANY(v_atoms) OR parent_atom_id = ANY(v_atoms);
    DELETE FROM public.career_atom_links
     WHERE from_atom_id = ANY(v_atoms) OR to_atom_id = ANY(v_atoms);
  END IF;
  DELETE FROM public.career_atom_links WHERE review_import_id = ANY(v_imports);
  DELETE FROM public.career_atom_links
   WHERE source_candidate_id IN (SELECT id FROM public.cv_parse_candidates WHERE import_id = ANY(v_imports));

  DELETE FROM public.atom_enrichment_proposals
   WHERE batch_id IN (SELECT id FROM public.atom_enrichment_batches WHERE user_id = v_user);
  DELETE FROM public.atom_enrichment_batches WHERE user_id = v_user;

  DELETE FROM public.cv_parse_candidates WHERE import_id = ANY(v_imports);
  IF array_length(v_atoms, 1) IS NOT NULL THEN
    DELETE FROM public.career_atoms WHERE id = ANY(v_atoms);
  END IF;

  DELETE FROM public.cv_imports WHERE id = ANY(v_imports) AND user_id = v_user;
END $$;