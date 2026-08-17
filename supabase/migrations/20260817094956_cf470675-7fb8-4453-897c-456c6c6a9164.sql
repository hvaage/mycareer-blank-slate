ALTER TABLE public.cv_atomization_jobs DROP CONSTRAINT IF EXISTS cv_atomization_jobs_status_check;
ALTER TABLE public.cv_atomization_jobs ADD CONSTRAINT cv_atomization_jobs_status_check
  CHECK (status = ANY (ARRAY['queued','running','complete','partial','failed','cancelled']));

CREATE OR REPLACE FUNCTION public.cv_atomization_job_cancel(p_job_id uuid)
RETURNS TABLE(job_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_status text;
begin
  select j.status into v_status
  from public.cv_atomization_jobs j
  where j.id = p_job_id and j.user_id = auth.uid()
  for update;

  if v_status is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  if v_status in ('queued','running') then
    update public.cv_atomization_job_blocks b
    set status = 'queued', started_at = null
    where b.job_id = p_job_id and b.status = 'running';

    update public.cv_atomization_jobs j
    set status = 'cancelled',
        lease_owner = null,
        lease_expires_at = null,
        finished_at = now()
    where j.id = p_job_id;
    v_status := 'cancelled';
  end if;

  return query select p_job_id, v_status;
end;
$$;

CREATE OR REPLACE FUNCTION public.cv_atomization_job_resume(p_job_id uuid)
RETURNS TABLE(job_id uuid, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_status text;
begin
  select j.status into v_status
  from public.cv_atomization_jobs j
  where j.id = p_job_id and j.user_id = auth.uid()
  for update;

  if v_status is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  if v_status in ('cancelled','partial','failed') then
    update public.cv_atomization_jobs j
    set status = 'queued',
        error_code = null,
        attempts = 0,
        lease_owner = null,
        lease_expires_at = null,
        finished_at = null
    where j.id = p_job_id;
    v_status := 'queued';
  end if;

  return query select p_job_id, v_status;
end;
$$;

REVOKE ALL ON FUNCTION public.cv_atomization_job_cancel(uuid) FROM public;
REVOKE ALL ON FUNCTION public.cv_atomization_job_resume(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_cancel(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_resume(uuid) TO service_role;