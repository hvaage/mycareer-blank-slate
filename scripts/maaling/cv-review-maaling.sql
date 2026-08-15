-- Måling av gjennomgangsflyten (fase 2.3) på en reell CV.
-- Kjøres etter at brukeren har lastet opp CV-en og fullført gjennomgangen.
-- Ren lesing. Endrer ingenting.
--
-- Bytt ut :import_id med id-en fra cv_imports (nyeste import brukes som standard).

with siste as (
  select id from public.cv_imports order by created_at desc limit 1
),
kand as (
  select c.* from public.cv_parse_candidates c join siste s on c.import_id = s.id
)

-- 1) Volum: kandidater, typevalg og spørsmål
select 'volum' as maaling, json_build_object(
  'kandidater', (select count(*) from kand),
  'bekreftet', (select count(*) from kand where status = 'bekreftet'),
  'spoersmaal', (select count(*) from kand where status = 'ble_sporsmal'),
  'avvist', (select count(*) from kand where status = 'avvist'),
  'ubehandlet', (select count(*) from kand where status = 'ubehandlet'),
  -- typevalg = kandidater der brukeren måtte ta stilling til type
  'typevalg_totalt', (select count(*) from kand where status <> 'ubehandlet'),
  'typevalg_uten_forhaandsvalg', (select count(*) from kand
     where status <> 'ubehandlet'
       and coalesce((structured_data ->> 'suggested_from_name_lexicon')::boolean, false) = false),
  'forhaandsvalg_fra_leksikon', (select count(*) from kand
     where coalesce((structured_data ->> 'suggested_from_name_lexicon')::boolean, false))
) as verdi

union all

-- 2) Tid: fra første til siste bekreftelse
select 'tid', json_build_object(
  'foerste_behandling', (select min(reviewed_at) from kand where reviewed_at is not null),
  'siste_behandling', (select max(reviewed_at) from kand where reviewed_at is not null),
  'varighet', (select max(reviewed_at) - min(reviewed_at) from kand where reviewed_at is not null)::text,
  'sekunder_per_kandidat', (
    select round(extract(epoch from (max(reviewed_at) - min(reviewed_at)))
      / nullif(count(*) filter (where reviewed_at is not null) - 1, 0), 1)
    from kand)
)

union all

-- 3) Korrigeringsrate per source_category
select 'korrigering_per_kategori', json_agg(rad order by rad ->> 'kategori')
from (
  select json_build_object(
    'kategori', coalesce(suggested_from_category, 'ukjent'),
    'behandlet', count(*),
    'korrigert', count(*) filter (where resolved_atom_type is distinct from suggested_atom_type),
    'korrigeringsrate', round(
      100.0 * count(*) filter (where resolved_atom_type is distinct from suggested_atom_type)
      / nullif(count(*), 0), 1)
  ) as rad
  from kand
  where status = 'bekreftet'
  group by coalesce(suggested_from_category, 'ukjent')
) k

union all

-- 4) Hvilke forslag ble korrigert til hva
select 'korrigeringer', coalesce(json_agg(json_build_object(
  'navn', content_no,
  'kategori', coalesce(suggested_from_category, 'ukjent'),
  'foreslaatt', suggested_atom_type,
  'valgt', resolved_atom_type
) order by content_no), '[]'::json)
from kand
where status = 'bekreftet' and resolved_atom_type is distinct from suggested_atom_type

union all

-- 5) Spørsmål: kompetanse uten evidens
select 'spoersmaal_detaljer', coalesce(json_agg(json_build_object(
  'navn', content_no,
  'foreslaatt', suggested_atom_type,
  'referanse', question_ref
) order by content_no), '[]'::json)
from kand
where status = 'ble_sporsmal';
