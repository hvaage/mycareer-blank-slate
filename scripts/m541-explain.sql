-- M5.4.1 diagnose: EXPLAIN på rekonstruert dynamisk SQL fra public.search_employers
-- Rekonstruert med p_limit=1 (warmup). Vi EXPLAIN-er kandidat-CTE-en isolert
-- fordi det er der LIMIT 300 + ORDER BY antall_ansatte DESC NULLS LAST, navn ASC
-- ligger — den dominerer kostnaden iht. funksjonens struktur.

\echo === bransje_it: kandidat-CTE ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.organisasjonsnummer
FROM reg.enheter e
WHERE coalesce(e.slettet,false)=false
  AND (
    e.naeringskode1_kode LIKE '62%'
    OR e.naeringskode1_kode LIKE '63%'
    OR (e.naeringskode1_beskrivelse ILIKE '%informasjonsteknologi%'
        OR e.naeringskode2_beskrivelse ILIKE '%informasjonsteknologi%'
        OR e.naeringskode3_beskrivelse ILIKE '%informasjonsteknologi%'
        OR e.aktivitet ILIKE '%informasjonsteknologi%')
    OR (e.naeringskode1_beskrivelse ILIKE '%kommunikasjonsteknologi%'
        OR e.naeringskode2_beskrivelse ILIKE '%kommunikasjonsteknologi%'
        OR e.naeringskode3_beskrivelse ILIKE '%kommunikasjonsteknologi%'
        OR e.aktivitet ILIKE '%kommunikasjonsteknologi%')
  )
ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn ASC
LIMIT 300;

\echo === bransje_it: kun NACE-prefiks (uten trigram-OR) ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.organisasjonsnummer
FROM reg.enheter e
WHERE coalesce(e.slettet,false)=false
  AND (e.naeringskode1_kode LIKE '62%' OR e.naeringskode1_kode LIKE '63%')
ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn ASC
LIMIT 300;

\echo === kommune_oslo: kandidat-CTE ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.organisasjonsnummer
FROM reg.enheter e
WHERE coalesce(e.slettet,false)=false
  AND e.forretningsadresse_kommunenummer = ANY(ARRAY['0301'])
ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn ASC
LIMIT 300;

\echo === min_omsetning_10m: kandidat-CTE (med MV-join) ===
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.organisasjonsnummer
FROM reg.enheter e
JOIN reg.regnskap_siste_per_org lr0 ON lr0.organisasjonsnummer = e.organisasjonsnummer
WHERE coalesce(e.slettet,false)=false
  AND lr0.driftsinntekter >= 10000000
ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn ASC
LIMIT 300;
