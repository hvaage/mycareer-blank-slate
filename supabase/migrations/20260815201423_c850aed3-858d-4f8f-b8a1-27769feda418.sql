-- Karriereontologi v4: slipp de utfasede atomtabellene.
-- Begge er tomme (verifisert) og ingen kode eller databaseobjekt leser dem.
DROP TABLE IF EXISTS public.user_evidence_atoms;
DROP TABLE IF EXISTS public.user_preference_atoms;