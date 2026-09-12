UPDATE public.survey_questions
SET
  question_type = 'scale'::public.survey_question_type,
  options = '["Nesten alltid gjennom aktiv Search", "Oftest gjennom aktiv Search", "Litt oftere gjennom aktiv Search", "Litt oftere gjennom innkomne søknader", "Oftest gjennom innkomne søknader", "Nesten alltid gjennom innkomne søknader"]'::jsonb,
  scale_min = 1,
  scale_max = 6,
  scale_min_label = 'Nesten alltid gjennom aktiv Search',
  scale_mid_label = 'Omtrent likt',
  scale_max_label = 'Nesten alltid gjennom innkomne søknader'
WHERE is_active = true
  AND question_text = 'Hvor ofte finner du kandidater gjennom aktiv Search kontra innkomne søknader?';

UPDATE public.survey_questions
SET
  question_type = 'scale'::public.survey_question_type,
  options = '["CV er klart viktigst", "CV er betydelig viktigere", "CV er litt viktigere", "LinkedIn er litt viktigere", "LinkedIn er betydelig viktigere", "LinkedIn er klart viktigst"]'::jsonb,
  scale_min = 1,
  scale_max = 6,
  scale_min_label = 'CV er klart viktigst',
  scale_mid_label = 'Omtrent like viktige',
  scale_max_label = 'LinkedIn er klart viktigst'
WHERE is_active = true
  AND question_text = 'Hvor viktig er LinkedIn sammenlignet med CV i den innledende vurderingen?';

UPDATE public.survey_questions
SET
  question_type = 'scale'::public.survey_question_type,
  options = '["Nesten aldri", "Sjelden", "Av og til", "Ganske ofte", "Ofte", "Svært ofte"]'::jsonb,
  scale_min = 1,
  scale_max = 6,
  scale_min_label = 'Nesten aldri',
  scale_mid_label = 'Av og til',
  scale_max_label = 'Svært ofte'
WHERE is_active = true
  AND question_text = 'Hvor ofte opplever du at kandidater overvurderer sin egen attraktivitet i markedet?';

UPDATE public.survey_questions
SET
  options = jsonb_set(options, '{0}', to_jsonb('De fleste kandidater har ingen eller liten formening'::text)),
  scale_min_label = 'De fleste kandidater har ingen eller liten formening'
WHERE is_active = true
  AND question_text = 'Hvilket utsagn stemmer best?';

UPDATE public.survey_questions
SET
  options = jsonb_set(
    jsonb_set(options, '{4}', to_jsonb('Mellom 3 og 5 minutter'::text)),
    '{5}',
    to_jsonb('Mer enn 5 minutter'::text)
  ),
  scale_max_label = 'Mer enn 5 minutter'
WHERE is_active = true
  AND question_text = 'Omtrent hvor lang tid bruker du normalt på første screening av en CV eller kandidatprofil?';

UPDATE public.survey_questions
SET options = (
  SELECT jsonb_agg(
    CASE
      WHEN value = 'Analyse av stillingsannonser'
        THEN to_jsonb('Egenutviklet eller selskapsutviklet løsning'::text)
      ELSE to_jsonb(value)
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements_text(options) WITH ORDINALITY AS option(value, ordinality)
)
WHERE is_active = true
  AND question_text = 'Hvilke AI-verktøy eller automatiserte løsninger bruker du i rekrutteringsarbeidet i dag?';