insert into public.cv_atomization_job_blocks (job_id, user_id, phase, block_key, label, sort_order, span_ids, status)
select j.id, j.user_id, 'skill_evidence', '__skill_evidence__', 'Finner hvilke roller og resultater som belegger kompetansene', 850, '{}', 'queued'
from public.cv_atomization_jobs j
where j.id = 'c5accf10-3532-459c-b166-99bc1a64b867'
  and not exists (select 1 from public.cv_atomization_job_blocks b where b.job_id = j.id and b.phase = 'skill_evidence');

update public.cv_atomization_job_blocks
set status='queued', finished_at=null, started_at=null, error_code=null
where job_id='c5accf10-3532-459c-b166-99bc1a64b867' and phase='consolidate';

update public.cv_atomization_jobs
set status='queued', phase='skill_evidence', finished_at=null, error_code=null, lease_owner=null, lease_expires_at=null
where id='c5accf10-3532-459c-b166-99bc1a64b867';