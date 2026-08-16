DROP FUNCTION IF EXISTS public.internal_ai_generation_commit_step(uuid,text,text,text,boolean,text,jsonb,jsonb,text,jsonb,jsonb,jsonb,uuid,text,text,jsonb);
UPDATE public.cv_generation_jobs
   SET status='queued', current_step='ats_format_check', attempt_count=0,
       locked_by=NULL, locked_at=NULL, lease_expires_at=NULL,
       run_after=now(), error_code=NULL, last_error=NULL, finished_at=NULL, updated_at=now()
 WHERE id='f503d57c-62b6-4dfb-ba37-62ed01adac8b';