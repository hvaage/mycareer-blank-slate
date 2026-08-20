DROP TABLE IF EXISTS public.canary_run_results;
CREATE TABLE public.canary_run_results AS
SELECT * FROM public.linkedin_promotion_phase4_canary();
ALTER TABLE public.canary_run_results ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.canary_run_results TO service_role;