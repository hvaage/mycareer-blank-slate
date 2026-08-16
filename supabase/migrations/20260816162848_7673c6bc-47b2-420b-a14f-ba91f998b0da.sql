-- Fase 2a: documents-felter, backfill og constraints (additivt)

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_group_id uuid,
  ADD COLUMN IF NOT EXISTS cv_variant text,
  ADD COLUMN IF NOT EXISTS opportunity_id uuid;

-- Backfill: hvert eksisterende dokument er sin egen gruppe-rot
UPDATE public.documents SET document_group_id = id WHERE document_group_id IS NULL;

ALTER TABLE public.documents ALTER COLUMN document_group_id SET NOT NULL;
ALTER TABLE public.documents ALTER COLUMN document_group_id SET DEFAULT gen_random_uuid();

-- Self-FK: gruppe-roten kan ikke slettes så lenge den har versjoner
ALTER TABLE public.documents
  ADD CONSTRAINT documents_document_group_id_fkey
  FOREIGN KEY (document_group_id) REFERENCES public.documents(id) ON DELETE RESTRICT;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_cv_variant_check
  CHECK (cv_variant IS NULL OR cv_variant IN ('generell','tilpasset'));

-- cv_variant er kun meningsfullt for CV-er; nullbar for alt annet
ALTER TABLE public.documents
  ADD CONSTRAINT documents_cv_variant_only_for_cv
  CHECK (cv_variant IS NULL OR document_type = 'cv'::public.document_type);

ALTER TABLE public.documents
  ADD CONSTRAINT documents_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.user_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_document_group_id_idx ON public.documents(document_group_id);
CREATE INDEX IF NOT EXISTS documents_opportunity_id_idx ON public.documents(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_user_cv_variant_idx ON public.documents(user_id, cv_variant) WHERE cv_variant IS NOT NULL;

COMMENT ON COLUMN public.documents.document_group_id IS 'Kanonisk versjonslinje. Alle versjoner av samme dokument deler gruppe-id (= id til første versjon).';
COMMENT ON COLUMN public.documents.cv_variant IS 'Kanonisk CV-variant: generell | tilpasset. NULL for ikke-CV.';
COMMENT ON COLUMN public.documents.opportunity_id IS 'Kanonisk stillingskobling for nye CV-er.';
COMMENT ON COLUMN public.documents.tailored_for IS 'LEGACY. Erstattet av opportunity_id + cv_variant. Skrives ikke av ny kode.';
COMMENT ON COLUMN public.documents.application_id IS 'LEGACY for CV-flyten. Erstattet av opportunity_id for nye CV-er.';
COMMENT ON COLUMN public.documents.is_base_version IS 'LEGACY. Erstattet av cv_variant = generell.';