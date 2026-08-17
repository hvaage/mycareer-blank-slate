update public.cv_atomization_job_blocks
set status='queued', finished_at=null, started_at=null, error_code=null
where job_id='c5accf10-3532-459c-b166-99bc1a64b867' and phase='consolidate';

update public.cv_atomization_jobs
set status='queued', phase='consolidate', finished_at=null, error_code=null, lease_owner=null, lease_expires_at=null,
    input_signature = input_signature || '+se2'
where id='c5accf10-3532-459c-b166-99bc1a64b867';