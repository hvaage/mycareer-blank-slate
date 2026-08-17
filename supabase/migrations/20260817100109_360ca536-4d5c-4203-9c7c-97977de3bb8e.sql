-- Godkjent, brukerspesifikk CV-reset for hvaage@gmail.com før ny ende-til-ende-test.
-- Sletter kun CV-relaterte rader. Auth-bruker, profil og arbeidsgiveranalyser røres ikke.
DELETE FROM public.cv_atomization_jobs WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.cv_review_progress WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.cv_parse_candidates WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.atom_enrichment_batches WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.career_atoms WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.cv_generation_jobs WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';
DELETE FROM public.cv_imports WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22';