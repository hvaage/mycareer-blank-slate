# Lovable-instruksjon: Arbeidsgiveranalysen fra PDF-mal til delt webvisning

## Port og ansvarsdeling

Kun frontend. Start ikke før Codex-backend er deployet og verifisert:

1. `20260623141000_employer_analysis_report_completeness.sql` er anvendt.
2. `analyze-company` er deployet fra samme `main`.
3. Begge canary-skriptene er PASS og avsluttet med `ROLLBACK`:
   - `scripts/canary/employer-analysis-shared-weighting-tests.sql`
   - `scripts/canary/employer-analysis-report-completeness-tests.sql`
4. Equinor ASA er analysert på nytt med `force=true`, og analysejobben er
   `completed`.

Lovable skal ikke endre `supabase/**`, migrasjoner, RPC-er, Edge Functions,
secrets, RLS, cron eller genererte Supabase-typer i denne leveransen.

## Låst datakilde

Offentlig og innlogget visning skal bruke samme RPC:

```ts
const { data, error } = await supabase.rpc('get_employer_analysis_view', {
  p_organisasjonsnummer: orgnr,
})
```

Canonical analyse ligger i `data.analysis`. Adminvektede totalscorer ligger i
`data.weighting.public`. Innlogget bruker får i tillegg
`data.weighting.personal`.

Ikke les analyse fra de seks gamle `companies.ai_*_score`-kolonnene. Ikke les
kilder fra `companies.research_log`. Ikke bruk `employer_reports` eller
historiske PDF-rapporter som canonical data.

## Delte komponenter og ruter

Bygg én delt presentasjonskomponent, for eksempel:

```text
src/components/employers/EmployerAnalysisReport.tsx
```

Bruk den i:

- offentlig rute: `/arbeidsgivere/$orgnr`
- innlogget rute: `/employers/$companyId`, etter at organisasjonsnummer er lest
  fra selskapet

Samme organisasjonsnummer skal gi identisk generell analyse i begge flater.
Den innloggede flaten legger bare til personlig vekting, kandidatmatch og
brukerens egne notater.

På den innloggede siden skal eksisterende manuell `Min vurdering`-funksjon
bevares, men flyttes ut av selve analyserapporten til en egen autentisert fane
eller et separat panel. Den skal ikke blandes inn i canonical dimensjonsscore.

## Fjern fra dagens side

1. Fjern `CompanyTargetAtomsSection` fra arbeidsgiverdetaljen.
2. Fjern knappen `Oppdater atomer`.
3. Fjern synlig `Selskapssignaler`, `Profil` og `Operative signaler`.
4. Ikke erstatt dette med annen atom-UI. Backend oppdaterer atomer automatisk
   når canonical analyse lagres.
5. Fjern overskriften `AI-vurdering (selskap)` og den gamle tabellen med seks
   stjerner.

## Rapportrekkefølge

### 1. Selskapshode

Vis:

- selskapsnavn
- organisasjonsnummer
- bransje og sted der det finnes
- `Analyse oppdatert <dato>` fra `company.analysis_rated_at`
- handling for å oppdatere analysen bare på innlogget side

Ikke bruk `AI` i hovedoverskriften.

### 2. Hovedfunn

Dette er første innholdsseksjon og erstatter `Sammendrag`.

- Overskrift: `Hovedfunn`
- Vis `analysis.key_findings` som 4-6 korte punkter.
- `analysis.executive_summary` kan vises som en kort orientering etter punktene,
  men aldri under overskriften `Sammendrag`.
- Ikke gjenta hele dimensjonsbegrunnelsene her.

### 3. Dimensjonsscore av selskapet

Overskrift: `Dimensjonsscore av selskapet`.

Bruk Recharts `RadarChart` til en åttekantet profil tilsvarende PDF-malen. Vis
alltid alle åtte akser i denne rekkefølgen:

1. Kultur og verdier
2. Ledelseskvalitet
3. Arbeidsmiljø
4. Karriereutvikling
5. Finansiell stabilitet
6. Misjon og formål
7. Rekruttering og retensjon
8. Mangfold og inkludering

Bruk `analysis.dimensions`, aldri interne nøkler som synlig tekst. Definer en
fast norsk fallback-map, slik at `talent_attraction_retention` og
`diversity_inclusion` aldri kan lekke til UI.

Ved siden av radaren vises:

- `weighting.public.employer.score` som `Samlet arbeidsgiverscore`
- `weight_coverage_percent`
- antall scorede dimensjoner av åtte

Dette er adminvektet totalscore. Råscore per akse kommer fra
`analysis.dimensions[].score`. `score=null` vises som `Ikke nok data`, ikke som
0, og skal ikke trekkes inn som nullscore i polygonet.

Under radaren vises åtte kompakte scorefelt, ikke bare seks. Bruk tallscore og
horisontal indikator. Stjernetabellen fjernes.

### 4. Finansiell oversikt

Vis siste tilgjengelige regnskapsår fra `financials`:

- driftsinntekter
- driftsresultat
- årsresultat
- egenkapital
- gjeld og/eller eiendeler der tilgjengelig
- driftsmargin og egenkapitalandel der tilgjengelig

Formater beløp med norsk locale og valuta. Vis regnskapsår tydelig.

Kildeetikett:

- `brreg_local_mirror`: `Lokalt speil av Brønnøysundregistrene`
- `official_web_fallback`: `Offisiell årsrapport eller investorinformasjon`

Ikke presenter offisiell web-fallback som Brønnøysunddata.

### 5. Detaljert gjennomgang av åtte dimensjoner

Bevar dagens detaljnivå. For hver dimensjon vises:

- norsk label
- råscore eller `Ikke nok data`
- evidensstatus som `Kildebelagt`, `Avledet` eller `Utilstrekkelig grunnlag`
- `rationale`
- `what_it_means` under etiketten `Hva dette betyr for en jobbsøker`

Bruk accordion eller tydelige fullbreddebånd. Ikke bygg kort inni kort.

### 6. ESG og regulatorisk profil

Bruk `analysis.supplemental_insights.esg_and_regulatory`:

- narrative
- highlights
- evidensstatus

Vis `Utilstrekkelig grunnlag` dersom status tilsier det. Ikke fyll med generisk
bærekraftstekst.

### 7. Trend i ansattomtaler

Bruk `analysis.supplemental_insights.employee_sentiment_trend`:

- direction: forbedring, stabil, fallende, blandet eller utilstrekkelig grunnlag
- narrative
- highlights

Ingen vurderingsplattform, ekstern score eller plattformlogo skal vises.

### 8. Lønnssignaler

Bruk `analysis.supplemental_insights.compensation_signals`.

- Vis selskapets egne opplysninger først der de finnes.
- Deretter kan offisiell lønnsstatistikk vises som intervall eller kontekst.
- Ikke presenter udokumenterte enkelttall.
- Ikke vis navn, lenker eller score fra lønns-/vurderingsplattformer.

### 9. AI-modenhet

Dette er en egen seksjon og må ikke blandes med arbeidsgiverdimensjonene.

Vis:

- `weighting.public.ai.score` som samlet adminvektet AI-modenhet
- `analysis.ai_maturity.narrative`
- fem områder fra `analysis.ai_maturity.signals`:
  1. Strategi og lederskap
  2. Kapabilitet og distribusjon
  3. Arbeidsstyrke
  4. Styring og ansvarlig bruk
  5. Marked og produkt
- `analysis.ai_maturity.key_evidence` under `Sentral evidens`

Bruk en egen femdelt graf eller fem horisontale scorelinjer. `score=null` vises
som `Ikke nok data`.

### 10. Din kandidatmatch - kun innlogget

Bevar kandidatmatchen i `user_company_ratings`. Den skal aldri vises offentlig
eller lagres på `companies`.

- Overskrift: `Din kandidatmatch`
- Scorelabel: `Kandidatmatch (deg)` - ikke `AI kandidatmatch (deg)`
- Vis eksisterende begrunnelse.
- Vis `ai_candidate_scenario_notes` som `Scenarienotater for deg`.
- Scenarienotatene skal knyttes til brukerens bakgrunn, kompetanse og
  preferanser.

Personlig vekting vises her eller i et nærliggende panel, tydelig adskilt fra
adminvektet offentlig score.

### 11. Helhetsvurdering

Analysen avsluttes med overskriften `Helhetsvurdering` og
`analysis.overall_assessment`.

Dette er generell selskapsanalyse. Den skal ikke omtale den innloggede brukeren.

### 12. Faste bunnlenker

Nederst i både offentlig og innlogget analyse:

- `Ansvarsfraskrivelse`
- `Metode og definisjoner`
- `Representerer du selskapet? Ta kontakt for å administrere profilen.`

Kontaktlenken er:

```text
mailto:hei@karrierenmin.no?subject=Eierskap%20til%20arbeidsgiverprofil%20-%20<SELSKAP>%20(<ORGNR>)
```

Lag frontend-ruter eller tilgjengelige dialoger for de to informasjonssidene.
Ingen døde lenker.

#### Ansvarsfraskrivelse

> Denne analysen er basert på offentlig tilgjengelig informasjon og webbasert
> research på analysetidspunktet. Scoren gjenspeiler en evidensbasert
> vurdering, men erstatter ikke direkte due diligence, samtaler med nåværende
> og tidligere ansatte eller profesjonell karriereveiledning. KarrierenMin.no
> gir ingen garantier for nøyaktighet, fullstendighet eller fortsatt gyldighet.
> Bruk analysen som ett av flere underlag i din ansettelsesbeslutning.

#### Metode og definisjoner

Vis:

- geografisk og juridisk scope
- scoreskala 1-5
- 1: vesentlig bekymring med konkret evidens
- 2: under gjennomsnitt, flere svake signaler
- 3: nøytral baselinje eller blandet evidens
- 4: over gjennomsnitt, flere støttende signaler
- 5: sterk og godt dokumentert på tvers av uavhengige kilder
- `Utilstrekkelig grunnlag`: færre enn to uavhengige kilder for en scoret
  arbeidsgiverdimensjon
- `Kildebelagt`: direkte støttet av evidens
- `Avledet`: logisk utledet fra indirekte signaler
- totalscore renormaliseres over dimensjoner som faktisk har score

## Kilder

Bruk bare `analysis.sources` fra RPC-responsen. Backend har allerede fjernet
ansattvurderings- og lønnsplattformene fra denne listen.

- Ikke bruk `research_log`.
- Ikke gjenskap filtrerte URL-er fra andre felt.
- Kildereferanser i dimensjoner og AI må bare lenkes når ID-en finnes i den
  filtrerte `analysis.sources`-listen. Skjul ellers referansen.
- Ikke vis vurderingsplattformnavn som tekst, lenke, tooltip eller domenenavn.
- Offisielle årsrapporter, myndighetskilder, registerkilder og redaksjonelle
  kilder kan vises med nøytral kategori.

## Personlig og administrativ vekting

Bevar tidligere godkjent vektingsflyt:

- offentlig/admin: `weighting.public`
- personlig: `weighting.personal`
- bruker lagrer med `set_my_employer_analysis_weights`
- bruker nullstiller med `reset_my_employer_analysis_weights`
- admin lager ny profilversjon med `set_employer_analysis_weight_profile`

Vekter er ikke råscore og skal ikke endre `analysis.dimensions` eller
`analysis.ai_maturity.signals`.

## Akseptanse

1. Equinor viser samme canonical analyse offentlig og innlogget.
2. `Sammendrag`, `Selskapssignaler`, `Profil`, `Operative signaler` og
   `Oppdater atomer` er borte fra analyserapporten.
3. Radar og scoreoversikt viser alle 8 dimensjoner med norske labels.
4. Rekruttering/retensjon og mangfold/inkludering vises både i oversikt og
   detalj.
5. Finansielle nøkkeltall for siste år vises med korrekt provenance.
6. ESG, omtaleutvikling og lønnssignaler har egne seksjoner.
7. AI-modenhet viser nøyaktig fem områder og sentral evidens.
8. Ingen vurderings- eller lønnsplattform er synlig eller lenket.
9. Kandidatmatch og scenarier er kun innlogget og brukerspesifikke.
10. Analysen avsluttes med helhetsvurdering og fungerende bunnlenker.
11. `Min vurdering` er bevart, men ikke blandet inn i canonical rapportscore.
12. Typecheck/build og skjermbilder på mobil og desktop er grønne uten
    overlapp, avkuttet tekst eller døde lenker.

Stopp etter frontendleveransen og rapporter endrede filer, testet
organisasjonsnummer, offentlig/innlogget sammenligning, 8+5-dekning,
finansprovenance, kildefilter, kandidatpersonvern, build og skjermbilder.
