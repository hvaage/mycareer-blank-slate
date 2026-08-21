-- Leveranse B: herding av tilgang og bruker-scopede koblinger på nettverksbatchen

REVOKE ALL ON public.linkedin_endorsement_staging FROM anon;
REVOKE ALL ON public.linkedin_endorsement_signals FROM anon;
REVOKE ALL ON public.network_contact_company_relations FROM anon;
REVOKE ALL ON public.user_company_relationships FROM anon;
REVOKE ALL ON public.linkedin_network_reconciliation_batches FROM anon;
REVOKE ALL ON public.linkedin_network_reconciliation_batch_items FROM anon;

GRANT SELECT ON public.linkedin_endorsement_staging TO authenticated;
GRANT SELECT ON public.linkedin_endorsement_signals TO authenticated;
GRANT SELECT ON public.network_contact_company_relations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_relationships TO authenticated;
GRANT SELECT ON public.linkedin_network_reconciliation_batches TO authenticated;
GRANT SELECT ON public.linkedin_network_reconciliation_batch_items TO authenticated;

GRANT ALL ON public.linkedin_endorsement_staging TO service_role;
GRANT ALL ON public.linkedin_endorsement_signals TO service_role;
GRANT ALL ON public.network_contact_company_relations TO service_role;
GRANT ALL ON public.user_company_relationships TO service_role;
GRANT ALL ON public.linkedin_network_reconciliation_batches TO service_role;
GRANT ALL ON public.linkedin_network_reconciliation_batch_items TO service_role;

-- Bruker-scopede sammensatte fremmednøkler: en batchrad kan aldri peke på
-- en annen brukers stagingpost eller kontakt.
ALTER TABLE public.linkedin_network_reconciliation_batch_items
  DROP CONSTRAINT IF EXISTS linkedin_network_reconciliation_batch_it_staging_record_id_fkey,
  DROP CONSTRAINT IF EXISTS linkedin_network_reconciliation_batch_it_target_contact_id_fkey;

ALTER TABLE public.linkedin_network_reconciliation_batch_items
  ADD CONSTRAINT linkedin_network_batch_items_staging_record_fkey
  FOREIGN KEY (staging_record_id, user_id)
  REFERENCES public.linkedin_staging_records(id, user_id)
  ON DELETE SET NULL (staging_record_id);

ALTER TABLE public.linkedin_network_reconciliation_batch_items
  ADD CONSTRAINT linkedin_network_batch_items_target_contact_fkey
  FOREIGN KEY (target_contact_id, user_id)
  REFERENCES public.network_contacts(id, user_id)
  ON DELETE SET NULL (target_contact_id);