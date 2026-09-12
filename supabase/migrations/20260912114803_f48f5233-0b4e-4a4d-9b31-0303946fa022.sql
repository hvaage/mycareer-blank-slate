update public.survey_questions set question_type = 'scale', scale_min = 1, scale_max = 6,
  scale_min_label = 'Ingen formening', scale_mid_label = 'Delt bilde', scale_max_label = 'Meget god forståelse',
  options = to_jsonb(array[
    'Ingen formening',
    'De aller fleste kandidater misforstår hvordan rekrutterere vurderer dem',
    'Mange kandidater misforstår hvordan rekrutterere vurderer dem',
    'Omtrent like mange forstår som misforstår hvordan de vurderes',
    'Flertallet forstår hovedtrekkene, men ikke alle nyansene',
    'Meget god forståelse – de fleste forstår hvordan de vurderes'
  ])
where id = 'a472879b-a9e6-43a1-b9d5-05bec02c38ca';

update public.survey_questions set question_type = 'scale', scale_min = 1, scale_max = 6,
  scale_min_label = 'Under 15 sekunder', scale_mid_label = '30–60 sekunder', scale_max_label = 'Varierer for mye',
  options = to_jsonb(array[
    'Under 15 sekunder',
    '15–30 sekunder',
    '30–60 sekunder',
    '1–3 minutter',
    'Mer enn 3 minutter',
    'Varierer for mye til å svare'
  ])
where id = '19b6d27c-662c-4416-9cc5-d22821dcf692';

update public.survey_questions set question_type = 'scale', scale_min = 1, scale_max = 6,
  scale_min_label = 'Vanskelig å vurdere', scale_mid_label = 'Av og til', scale_max_label = 'Svært tydelig',
  options = to_jsonb(array[
    'Vanskelig å vurdere',
    'Sjelden',
    'Av og til',
    'Ofte',
    'Tydelig i de fleste tilfeller',
    'Svært tydelig – og ofte negativt'
  ])
where id = 'c3bc878b-aaf0-4961-b7e9-b2d8ca4e6fb4';