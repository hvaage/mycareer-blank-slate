UPDATE public.survey_questions AS q
SET question_type = 'multi_choice'::public.survey_question_type,
    max_choices = NULL,
    options = '["AI har foreløpig liten betydning","Jeg ser mer etter digital forståelse","Jeg ser mer etter evne til å bruke AI praktisk","Jeg ser mer etter læringsevne og omstillingsevne","Jeg ser mer etter kritisk tenkning","Jeg ser mer etter dokumenterte resultater, fordi CV-er og søknader er lettere å forbedre med AI","AI har gjort søknadsbrev mindre interessant","Annet"]'::jsonb,
    updated_at = now()
FROM public.survey_versions AS v
WHERE q.version_id = v.id
  AND v.slug = 'rekrutterer'
  AND v.is_active = true
  AND q.question_text = 'Hvordan har AI endret hva du ser etter hos kandidater?';

UPDATE public.survey_questions AS q
SET options = '["De fleste kandidater forstår godt hvordan rekrutterere vurderer dem i den første utvelgelsen.","Flertallet av kandidatene forstår hovedtrekkene i hvordan rekrutterere vurderer dem, men ikke alle nyansene.","Omtrent like mange kandidater forstår som misforstår hvordan rekrutterere vurderer dem.","Mange kandidater misforstår hvordan rekrutterere vurderer dem i den første utvelgelsen.","De aller fleste kandidater misforstår hvordan rekrutterere vurderer dem i den første utvelgelsen."]'::jsonb,
    updated_at = now()
FROM public.survey_versions AS v
WHERE q.version_id = v.id
  AND v.slug = 'rekrutterer'
  AND v.is_active = true
  AND q.question_text = 'Hvilket utsagn stemmer best?';

UPDATE public.survey_questions AS q
SET options = q.options || '["Annet"]'::jsonb,
    updated_at = now()
FROM public.survey_versions AS v
WHERE q.version_id = v.id
  AND v.slug = 'rekrutterer'
  AND v.is_active = true
  AND q.question_text = 'Hvilke kandidatferdigheter tror du blir viktigere de neste 12–24 månedene?'
  AND NOT (q.options @> '["Annet"]'::jsonb);