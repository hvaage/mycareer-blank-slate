# Lovable-instruksjon: Felles arbeidsgiveranalyse, vekting og modell-QC

## Implementeringsport

Kun frontend. Start ikke før Codex-backend er deployet og disse portene er
grønne:

1. `20260623113000_employer_analysis_shared_weighting.sql` er applied.
2. `analyze-company` er deployet med `index.ts`, `analysis-v2.ts` og
   `research-v1.ts`, fortsatt `verify_jwt=true`.
3. `scripts/canary/employer-analysis-shared-weighting-tests.sql` er PASS og
   avsluttet med `ROLLBACK`.
4. Minst én kontrollert produksjonsanalyse har skrevet
   `companies.employer_analysis_v2.schema_version=2` og en vellykket rad i
   `employer_analysis_model_runs`.

Lovable skal ikke endre `supabase/**`, SQL, RPC-er, Edge Functions, secrets,
cron, RLS eller genererte Supabase-typer i denne leveransen.

## Låst hovedregel

`companies.employer_analysis_v2` er eneste canonical arbeidsgiveranalyse.
Offentlig og innlogget flate skal vise samme:

- råscore på de åtte arbeidsgiverdimensjonene
- råscore på de fem AI-områdene
- begrunnelser, evidensstatus og kilder
- register- og regnskapsgrunnlag
- adminvektede totalscorer

Innlogget flate viser i tillegg personlige totalscorer beregnet fra brukerens
egne vekter. Personlig vekting skal aldri endre canonical analyse eller råscore.

## Backendkontrakt

Hent visningsmodellen med:

```ts
const { data, error } = await supabase.rpc('get_employer_analysis_view', {
  p_organisasjonsnummer: orgnr,
})
```

Samme RPC brukes anonymt og innlogget. Ikke bygg to datakilder.

Responsens hovedform:

```ts
type EmployerAnalysisView = {
  schema_version: 1
  organisasjonsnummer: string
  company: {
    id?: string
    name?: string
    domain?: string
    industry?: string
    analysis_version?: number
    analysis_rated_at?: string
    analysis_source_updated_at?: string
  }
  register: EmployerRegisterContext | null
  financials: EmployerFinancials | null
  analysis: EmployerAnalysisV2 | null
  weighting: {
    admin_profile: {
      version: number
      employer_weights: Record<EmployerDimensionKey, number>
      ai_weights: Record<AiDimensionKey, number>
    }
    public: {
      employer: WeightedScore
      ai: WeightedScore
    }
    personal: null | {
      is_customized: boolean
      employer_weights: Record<EmployerDimensionKey, number>
      ai_weights: Record<AiDimensionKey, number>
      employer: WeightedScore
      ai: WeightedScore
    }
  }
}

type WeightedScore = {
  score: number | null
  scored_dimensions: number
  total_dimensions: number
  weight_coverage_percent: number
}
```

`analysis` inneholder de avtalte åtte dimensjonene, fem AI-signalene, nøytrale
kildekategorier og provenance. Bruk råscorene til radar/barer og de beregnede
`weighting.*`-feltene til totalscore.

## 1. Juridisk arbeidsgiver

I `src/routes/_authenticated/employers/index.tsx`:

1. Bevar brukerens eksisterende arbeidsgiverliste.
2. Bruk eksisterende `searchEmployersQuery`/`searchEmployers` fra
   `src/lib/queries/employer-insight.ts` ved ny norsk analyse.
3. Vis navn, organisasjonsnummer, sted, næringskode, ansatte og siste omsetning.
4. Brukeren må velge juridisk enhet. Ikke velg første navnetreff automatisk.
5. Kall `analyze-company` med `organisasjonsnummer`, `name` og innlogget
   `user_id`.
6. Utenlandske selskaper kan fortsatt bruke en tydelig separat navn/domene-flyt.

## 2. Samme offentlige og innloggede analyse

Disse sidene skal bruke `get_employer_analysis_view`:

- offentlig: `/arbeidsgivere/$orgnr`
- innlogget: `/employers/$companyId`, etter at orgnr er lest fra `company`

Trekk analysevisningen ut i delte presentasjonskomponenter under
`src/components/employers/`. Ikke kopier analyse-/vektlogikk mellom rutene.

På `/selskapsanalyse` skal søk/CTA til en eksisterende norsk virksomhet føre
til `/arbeidsgivere/$orgnr`. `employer_reports` og
`/selskapsanalyse/analysedatabase` er et historisk rapportarkiv, ikke canonical
datakilde. Merk arkivet som historiske rapporter; ikke bland arkivscore inn i
den nye analysen.

## 3. Register og finans

- Vis Enhetsregister-data og inntil tre regnskapsår fra `register`.
- Dersom `financials.source_kind='brreg_local_mirror'`, vis
  `Lokalt speil av Brønnøysundregistrene`.
- Dersom `financials.source_kind='official_web_fallback'`, vis
  `Offisiell årsrapport eller investorinformasjon` og rapporteringsperiode.
- Ikke presenter web-fallback som Brønnøysunddata.
- Ikke kall `reg.*` direkte fra frontend.

## 4. Åtte arbeidsgiverdimensjoner

Gjenbruk `DimensionsRadar`. Vis fast rekkefølge:

1. Kultur og verdier
2. Ledelseskvalitet
3. Arbeidsmiljø
4. Karriereutvikling
5. Finansiell stabilitet
6. Misjon og formål
7. Rekruttering og retensjon
8. Mangfold og inkludering

Vis råscore per dimensjon, evidensstatus, begrunnelse, `Hva dette betyr` og
kildereferanser. `score=null` vises som `Ikke nok data` og tegnes ikke som 0.

Øverst vises `weighting.public.employer.score` som
`Samlet arbeidsgiverscore (administrativ vekting)` med dekningsgrad.

## 5. Fem AI-områder

Bruk bare `analysis.ai_maturity.signals`:

1. Strategi og lederskap
2. Kapabilitet og distribusjon
3. Arbeidsstyrke
4. Styring og ansvarlig bruk
5. Marked og produkt

Vis råscore og begrunnelse per område grafisk. Vis
`weighting.public.ai.score` som samlet administrativt vektet AI-score. Ikke map
de gamle seks selskapsscorene inn i AI-panelet.

## 6. Personlig vekting

Kun innlogget side:

- Vis offentlig/adminvektet score og personlig score side om side, tydelig
  navngitt.
- Et eget panel lar brukeren justere vekter 0-10 for alle 8+5 områder.
- Bruk slider eller stepper med tallverdi; vekting er ikke en råscore.
- Lagre med `set_my_employer_analysis_weights(p_employer_weights,p_ai_weights)`.
- Nullstill med `reset_my_employer_analysis_weights()`.
- Hent RPC-en på nytt etter lagring/nullstilling.
- Når `is_customized=false`, vis at personlig score foreløpig bruker
  standardvektingen.

## 7. Adminvekting

Ny frontendflate `/admin/employer-analysis`, admin-gated med eksisterende
rollemønster:

- Hent aktiv profil med `get_employer_analysis_weight_config()`.
- Vis versjon og alle 8+5 vekter.
- Lag en ny versjon med
  `set_employer_analysis_weight_profile(p_employer_weights,p_ai_weights,p_note)`.
- Ingen redigering av historisk profil; lagring oppretter ny aktiv versjon.
- Forklar i kort brukerrettet tekst at adminvektingen styrer offentlig totalscore,
  men ikke råscorene.

## 8. Modellbenchmark for admin

På samme adminside, egen fane `Modelltest`:

- Vis `employer_analysis_model_runs` for `run_mode='benchmark'`.
- Grupper på `benchmark_group_id` og vis modell, kilder, dekningsgrad, varighet,
  tokenbruk, estimert kostnad og om kostnadsestimatet er komplett.
- Vis analysene side om side uten modellnavn i selve vurderingspanelet før admin
  åpner metadata, slik at kvalitetsvurderingen blir mindre påvirket.
- Lagre adminreview med `review_employer_analysis_model_run(...)` for:
  faktanøyaktighet, kildekvalitet, scope-presisjon, finansiell kvalitet og
  analysekvalitet, alle 1-5.
- Hent gruppesammendrag med `get_employer_analysis_benchmark_report(group_id)`.
- Frontend skal ikke kunne gjøre benchmarkmodell til produksjonsstandard.

Selve benchmarkkjøringene startes operasjonelt etter egen Codex-instruksjon;
ikke legg modellvalg eller secrets i klienten.

## 9. Nøytral kildepresentasjon

Ikke vis navn på ansattvurderings-, omdømme- eller
lønnssammenligningsplattformer i synlig tekst eller lenketekst.

Vis `Kilde 1`, `Kilde 2` osv. med nøytral kategori. URL kan ligge i `href` for
sporbarhet. Bevar kategoriene `Årsrapport` og `Investorinformasjon`.

## Tillatte frontendfiler

- `src/routes/_authenticated/employers/**`
- `src/routes/arbeidsgivere.$orgnr.tsx`
- relevante presentasjonsdeler i `src/routes/selskapsanalyse*`
- `src/routes/_authenticated/admin.employer-analysis.tsx`
- `src/components/employers/**`
- `src/components/selskapsanalyse/DimensionsRadar.tsx`
- rene frontendtyper/query-wrappere under `src/lib/`
- adminmenylenke til den nye, eksisterende ruten

Ikke endre `supabase/**`, auth-backend, navigasjonsarkitekturen, cron, secrets
eller genererte Supabase-typer manuelt.

## Akseptanse

1. Samme orgnr gir identisk canonical analyse offentlig og innlogget.
2. Offentlig side viser adminvektet 8-score og 5-AI-score.
3. Innlogget side viser de samme scorene samt personlig vekting.
4. Endring av brukerens vekter endrer bare personlig totalscore.
5. Endring av adminprofil oppretter ny versjon og endrer offentlig totalscore,
   ikke råscore.
6. Brønnøysund og offisiell web-fallback er tydelig adskilt.
7. Alle 8+5 rådimensjoner vises; null vises ikke som 0.
8. Ingen vurderingsplattform er navngitt i synlig analyse.
9. Historiske rapporter merkes som historiske og blandes ikke inn i canonical
   score.
10. Typecheck/build og desktop/mobilkontroll er grønne.

Stopp etter frontend og rapporter endrede filer, testet orgnr, RPC-responser,
offentlig/innlogget likhet, admin-/brukervekting, fallback og buildresultat.
