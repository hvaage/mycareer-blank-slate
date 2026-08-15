
ALTER FUNCTION public.brreg_full_gate_counts(bigint) SET statement_timeout = '120s';
ALTER FUNCTION public.brreg_full_gate_overlap(bigint) SET statement_timeout = '120s';
ALTER FUNCTION public.brreg_full_gate_markers(bigint) SET statement_timeout = '120s';
ALTER FUNCTION public.brreg_full_gate_excluded_in_mirror(bigint) SET statement_timeout = '120s';
ALTER FUNCTION public.brreg_full_gate_absent(bigint) SET statement_timeout = '120s';
ALTER FUNCTION public.brreg_full_gate_metrics(bigint) SET statement_timeout = '600s';
