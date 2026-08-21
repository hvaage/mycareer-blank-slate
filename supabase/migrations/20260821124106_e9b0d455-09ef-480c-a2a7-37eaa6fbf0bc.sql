ALTER TABLE public.linkedin_import_file_purposes
  DROP CONSTRAINT IF EXISTS linkedin_import_file_purposes_status_check;

UPDATE public.linkedin_import_file_purposes
   SET status = 'skipped_no_selected_purpose'
 WHERE status = 'skipped_no_consent';

ALTER TABLE public.linkedin_import_file_purposes
  ADD CONSTRAINT linkedin_import_file_purposes_status_check
  CHECK (status IN (
    'pending',
    'staged',
    'skipped_no_selected_purpose',
    'deferred',
    'failed',
    'excluded_before_staging'
  ));