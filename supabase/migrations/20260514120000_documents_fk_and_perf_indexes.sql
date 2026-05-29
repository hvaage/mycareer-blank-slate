-- PostgREST requires a real FK from documents.application_id → applications.id
-- for embeds like: .select('*, applications(...)').
-- Safe: SET NULL on delete keeps orphan documents if an application is removed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_application_id_fkey'
  ) THEN
    UPDATE public.documents d
    SET application_id = NULL
    WHERE d.application_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.application_id);

    ALTER TABLE public.documents
      ADD CONSTRAINT documents_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.applications (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_application_id
  ON public.documents (application_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_user_updated_at
  ON public.documents (user_id, updated_at DESC NULLS LAST);

-- Speed next_steps list + applications_with_urgency document_count subquery
DO $$
BEGIN
  IF to_regclass('public.next_steps') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_next_steps_application_id
      ON public.next_steps (application_id);
    CREATE INDEX IF NOT EXISTS idx_next_steps_app_completed_due
      ON public.next_steps (application_id, completed, due_date);
  END IF;
END $$;
