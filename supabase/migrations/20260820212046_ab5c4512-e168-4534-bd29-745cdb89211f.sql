-- Fase 5: next_steps migrering til bruker-scopede sammensatte fremmednøkler.

ALTER TABLE public.next_steps
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.user_opportunities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Backfill user_id fra application_id der det finnes.
UPDATE public.next_steps
   SET user_id = a.user_id
  FROM public.applications a
 WHERE next_steps.application_id = a.id
   AND next_steps.user_id IS NULL;

-- For rader uten application_id, kan vi ikke gjette user_id.
DELETE FROM public.next_steps WHERE user_id IS NULL;

ALTER TABLE public.next_steps
  ALTER COLUMN user_id SET NOT NULL;

-- Sørg for at minst én eier-referanse finnes.
ALTER TABLE public.next_steps
  DROP CONSTRAINT IF EXISTS next_steps_owner_check;

ALTER TABLE public.next_steps
  ADD CONSTRAINT next_steps_owner_check
  CHECK (application_id IS NOT NULL OR contact_id IS NOT NULL OR company_id IS NOT NULL OR opportunity_id IS NOT NULL);

-- Oppdater RLS-policy for next_steps.
DROP POLICY IF EXISTS "Users can manage own next steps" ON public.next_steps;

CREATE POLICY "Users can manage own next steps"
  ON public.next_steps
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Gi authenticated tilgang til next_steps hvis det mangler.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.next_steps TO authenticated;
GRANT ALL ON public.next_steps TO service_role;

-- Indekser for bruker-scopede oppslag.
CREATE INDEX IF NOT EXISTS next_steps_user_id_idx ON public.next_steps (user_id);
CREATE INDEX IF NOT EXISTS next_steps_contact_id_idx ON public.next_steps (contact_id);
CREATE INDEX IF NOT EXISTS next_steps_company_id_idx ON public.next_steps (company_id);
CREATE INDEX IF NOT EXISTS next_steps_opportunity_id_idx ON public.next_steps (opportunity_id);

SELECT 1;