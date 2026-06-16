-- 1) Ny spørsmålstype: ranked_choice (topp N i prioritert rekkefølge)
ALTER TYPE public.survey_question_type ADD VALUE IF NOT EXISTS 'ranked_choice';
