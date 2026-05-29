-- Foundation for public.documents (must run before any ALTER TABLE public.documents).
-- Root cause: later migrations alter documents but no migration created the table.
-- Adds minimal columns required by app inserts/selects; company_name, mime_type (06142005),
-- atom_* / render fields (08181036), documentation_* (20260509) remain ALTER-only.

DO $$ BEGIN
  CREATE TYPE public.document_type AS ENUM (
    'cv',
    'søknadsbrev',
    'case_dokument',
    'referanseliste',
    'annet'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid,
  title text NOT NULL,
  document_type public.document_type NOT NULL,
  content_text text,
  file_path text,
  file_name text,
  file_size_bytes bigint,
  is_base_version boolean DEFAULT false,
  tailored_for text,
  customization_notes text,
  version integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;

CREATE POLICY "Users can view own documents"
  ON public.documents FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON public.documents FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Same trigger name as min dokumentasjon migration so 20260509 can DROP/REPLACE with update_updated_at_column.
DROP TRIGGER IF EXISTS min_dok_documents_updated_at ON public.documents;
CREATE TRIGGER min_dok_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
