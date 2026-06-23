# Lovable-instruksjon: Arbeidsgiveranalyse v2 i innlogget flate

## Implementeringsport

Start ikke frontendarbeidet for denne leveransen før Codex-backend er deployet og
akseptansetesten `scripts/canary/employer-analysis-register-v2-tests.sql` er
grønn.

Lovable eier kun frontend. Ikke endre `supabase/`, migrasjoner, SQL, RPC-er,
Edge Functions, secrets, cron, auth-backend eller genererte Supabase-typer.

## Backendkontrakt

`companies` har fått disse additive feltene:

- `organisasjonsnummer: text | null`
- `employer_analysis_v2: jsonb | null`
- `employer_analysis_version: number | null`
- `employer_analysis_rated_at: string | null`
- `employer_analysis_source_updated_at: string | null`
- `financials: jsonb | null`, med `source_kind='brreg_local_mirror'` når lokalt
  regnskapsgrunnlag er brukt

`employer_analysis_v2` har denne formen:

```ts
type EmployerAnalysisV2 = {
  schema_version: 2
  overall: {
    score: number | null
    scored_dimensions: number
    total_dimensions: 8
  }
  executive_summary: string
  key_findings: string[]
  dimensions: Array<{
    key:
      | 'culture'
      | 'leadership'
      | 'work_environment'
      | 'career_development'
      | 'financial_stability'
      | 'mission'
      | 'talent_attraction_retention'
      | 'diversity_inclusion'
    label: string
    score: number | null
    evidence_status: 'sourced' | 'inferred' | 'insufficient_evidence'
    rationale: string
    what_it_means: string
    source_ids: number[]
  }>
  ai_maturity: {
    applicable: boolean
    applicability_note: string | null
    score: number | null
    narrative: string
    signals: Record<
      | 'strategy_and_leadership'
      | 'capability_and_deployment'
      | 'workforce'
      | 'governance'
      | 'market_and_product',
      {
        label: string
        score: number | null
        rationale: string
        source_ids: number[]
      }
    >
    key_evidence: string[]
    source_ids: number[]
  }
  sources: Array<{
    id: number
    url: string
    category:
      | 'official_company'
      | 'official_register'
      | 'annual_report'
      | 'news_media'
      | 'regulator'
      | 'employee_reviews'
      | 'salary_benchmark'
      | 'other'
  }>
  register_provenance: {
    source: 'brreg_local_mirror'
    organisasjonsnummer: string
    source_updated_at: string | null
    financial_years: number[]
  } | null
}
```

De seks gamle `ai_*_score`-feltene oppdateres fortsatt av backend for
kompatibilitet. Ny frontend skal bruke `employer_analysis_v2` når
`schema_version === 2`, og falle tilbake til dagens seksdimensjonsvisning bare
for historiske rader uten v2-data.

## 1. Velg juridisk arbeidsgiver fra registerspeilet

Dagens fritekstflyt oppretter en `companies`-rad bare fra navn. Det gjør at
analysen mister koblingen til Brønnøysund og lokalt regnskap.

I `src/routes/_authenticated/employers/index.tsx`:

1. Bevar listen over brukerens eksisterende arbeidsgivere.
2. Når brukeren søker etter en ny arbeidsgiver, bruk eksisterende
   `searchEmployersQuery`/`searchEmployers` fra
   `src/lib/queries/employer-insight.ts`.
3. Vis treff som juridiske enheter med navn, organisasjonsnummer, sted,
   næringskode, ansatte og siste tilgjengelige omsetning.
4. Brukeren skal velge en konkret juridisk enhet før norsk arbeidsgiveranalyse
   startes. Ikke velg første navnetreff automatisk.
5. Kall `analyze-company` med:

```ts
{
  organisasjonsnummer: row.organisasjonsnummer,
  name: row.navn,
  user_id: uid
}
```

6. Naviger til returnert `company_id` som i dagens flyt.
7. For utenlandske selskaper uten norsk organisasjonsnummer kan eksisterende
   navne-/domeneflyt beholdes som en tydelig separat handling.

På detaljsiden skal ny analyse sende både `company_id` og selskapets
`organisasjonsnummer` når dette finnes.

## 2. Register og regnskap først

På `/_authenticated/employers/$companyId`:

- Dersom selskapet har organisasjonsnummer, hent eksisterende
  `employerDetailQuery(organisasjonsnummer)` fra
  `src/lib/queries/employer-insight.ts`.
- Gjenbruk `RegisterPanel` for Enhetsregisteret og siste regnskapsår.
- Vis i tillegg 2-3 års regnskapstrend fra `company.financials.history` når den
  finnes: driftsinntekter, driftsresultat, årsresultat og egenkapitalandel.
- Bruk kompakt tabell eller linje-/stolpediagram med tydelig år og valuta.
- Vis datakilde som `Lokalt speil av Brønnøysundregistrene`, aldri som Proff
  eller en annen aggregator.
- Ikke gjør nye direkte kall mot `reg.*`.

## 3. Grafisk visning av 8 arbeidsgiverdimensjoner

Gjenbruk eller trekk ut dagens
`src/components/selskapsanalyse/DimensionsRadar.tsx`. Ingen ny chart-pakke.

Vis:

- samlet score og `N av 8 dimensjoner`
- radar med alle åtte dimensjoner i fast rekkefølge
- to-kolonners scoreoversikt med horisontal scoreindikator
- detalj per dimensjon: score, evidensstatus, begrunnelse og `Hva dette betyr`
- `Ikke nok data` for `score=null`; null skal ikke tegnes som en reell
  nullscore eller tolkes negativt

Rekkefølge:

1. Kultur og verdier
2. Ledelseskvalitet
3. Arbeidsmiljø
4. Karriereutvikling
5. Finansiell stabilitet
6. Misjon og formål
7. Rekruttering og retensjon
8. Mangfold og inkludering

## 4. Grafisk visning av fem AI-områder

Ikke map de gamle seks selskapsscorene inn i AI-panelet. Bruk de dedikerte
signalene i `employer_analysis_v2.ai_maturity.signals`.

Vis:

- samlet AI-modenhetsscore
- fem stabile horisontale scorebarer eller et eget fem-akset diagram
- score og begrunnelse for hvert område
- samlet narrativ og sentrale evidenspunkter
- `Ikke vurdert - lav bransjerelevans` når `applicable=false`

Områdene er:

1. Strategi og lederskap
2. Kapabilitet og distribusjon
3. Arbeidsstyrke
4. Styring og ansvarlig bruk
5. Marked og produkt

## 5. Nøytral kildepresentasjon

Ikke vis navnene på ansattvurderings-, omdømme- eller
lønnssammenligningsplattformer i sammendrag, kort, tabeller eller
lenketekster.

Vis kildene med nøytrale kategorier:

- Selskapets egne kilder
- Offentlige registre
- Årsrapport og finansiell rapportering
- Redaksjonelle kilder
- Myndighets- og regulatorkilder
- Uavhengige ansattvurderinger
- Lønnssammenligningskilder
- Andre eksterne kilder

Kildelenker kan beholdes for sporbarhet, men lenketeksten skal være `Kilde 1`,
`Kilde 2` osv. Ikke skriv rå URL eller domenenavn som synlig tekst.

## 6. Terminologi og status

Endre brukerrettet tekst fra `AI-vurdering (selskap)` til
`Arbeidsgiveranalyse`.

Beskriv analysen som:

`Register- og regnskapsdata fra lokalt Brønnøysundspeil, supplert med aktuell webresearch og uavhengige kilder.`

Fremdriftstekster skal ikke navngi modellleverandør eller eksterne
vurderingsplattformer.

Bevar kandidatmatch, manuell brukervurdering og brukersnitt som separate
seksjoner. Ikke bland personlige kandidatdata inn i selskapets felles analyse.

## Tillatte frontendfiler

- `src/routes/_authenticated/employers/index.tsx`
- `src/routes/_authenticated/employers/$companyId.tsx`
- `src/components/employers/*`
- eventuelt en ren frontendtype/helper under `src/lib/`

Ikke endre:

- `supabase/**`
- `src/integrations/supabase/types.ts` manuelt
- auth, RLS, RPC-er, Edge Functions, secrets eller cron
- offentlige ruter eller sidepanelarbeidet i samme leveranse

## Akseptansekriterier

1. Norsk arbeidsgiveranalyse kan ikke startes fra et tvetydig fritekstnavn;
   brukeren velger juridisk enhet med organisasjonsnummer.
2. Request til `analyze-company` inneholder organisasjonsnummer.
3. Register- og regnskapsdata vises før eller sammen med webanalysen.
4. V2-resultat viser radar og alle åtte dimensjoner.
5. Alle fem dedikerte AI-signaler vises grafisk.
6. Ingen vurderingsplattform er navngitt i synlig analysetekst eller lenketekst.
7. Historiske selskaper uten v2-data beholder dagens fallback.
8. Kandidatmatch, manuell vurdering og brukersnitt fungerer uendret.
9. Typecheck og produksjonsbuild er grønne.
10. Desktop og mobil er kontrollert uten overlapp, avkuttet tekst eller
    layoutskift når analysen lastes.

Rapporter endrede filer, testet organisasjonsnummer, request-body,
v2-rendering, fallback og resultat fra typecheck/build. Stopp etter frontend og
rapport; ikke utfør backendarbeid.
