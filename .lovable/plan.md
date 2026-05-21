## Hva skillen sender (presisert)

Hver gang en bruker genererer en rapport, kaller `scripts/submit_report.py` endepunktet fra `config.json` med en JSON-payload som kun inneholder selskaps-/rapportdata — ingen PII, ingen PDF. Skjemaet (`schema_version: "1.0"`):

```text
submitted_at            ISO-timestamp (UTC)
language                "nb" | "sv" | "da" | ... (12 språk)
tier                    "standard" | "extended"
company.name            "Equinor ASA"
company.domain          "equinor.com"
company.branch_country  "Norway"
company.parent_country  null | "Sweden"
company.analysis_date   "2026-05-19"
overall.score           4.1                  -- totalscore (1.0–5.0)
overall.scored_dimensions   7                -- antall dimensjoner med nok data
overall.total_dimensions    8
dimensions[]            { name, score, label, source_count }   ← ALLE 8 ALLTID MED
source_count            antall siterte kilder
search_count            antall søk brukt
scope_deviation         true hvis land utenfor offisielt scope
```

**Per-dimensjon:** Nei, det er ikke kun overall som sendes. Skillen sender alltid alle åtte dimensjonene som en array. Hver dimensjon har:
- `name` — f.eks. "Culture and Values"
- `score` — numerisk 1.0–5.0, eller `null` når dimensjonen ikke kunne scores
- `label` — statusstreng fra skillen: `"sourced"`, `"partial"`, `"insufficient_data"`, `"not_assessed"`
- `source_count` — antall kilder brukt for denne dimensjonen

Dimensjoner uten nok data har `score: null` + `label: "insufficient_data"` — den informasjonen bevarer vi i databasen og viser eksplisitt i UI (grå "Ikke nok data" i stedet for tom celle). Forholdstallet `scored_dimensions / total_dimensions` brukes som datakvalitets-indikator på listekortet.

**Det som mangler i dagens skill-payload (må legges til):**

1. **`company.employee_count`** — skillen samler i dag faktisk ansatt-tall fra registre (Brønnøysund/Bisnode for Norge, Bundesanzeiger for Tyskland osv.) men strippes bort av `_strip_to_anonymous_payload`. Vi utvider payloaden med:
   - `company.employee_count` (int eller null)
   - `company.employee_count_source` (kort kildenavn, f.eks. `"brreg"`)
   - `company.employee_count_as_of` (dato kildedataen ble registrert)
   - `company.revenue_bucket` (`<10M | 10–100M | 100M–1B | >1B EUR`, null hvis ukjent) — også fint for historikk
   - `company.industry_nace` (NACE 2-siffer kode, null hvis ukjent)

   Dette gjør at vi over tid kan vise utviklingskurver for selskapsstørrelse, omsetningsbøtte og bransjekontekst.

2. **`report_id` (klient-generert UUID)** — for idempotens, så samme rapport ikke teller dobbelt hvis skillen retry-er ved nettverksfeil.

Disse legges til i `scripts/submit_report.py` sin `_strip_to_anonymous_payload` og bumper `schema_version` til `1.1`. Mottaket håndterer både 1.0 og 1.1.

---

## Historikk over tid

Hver innsending er en egen rad — vi sletter aldri og oppdaterer aldri. Det gir en naturlig tidsserie per selskap:

- **Per `company_domain`** kan vi vise: overall-score over tid, score-utvikling per dimensjon (8 små sparklines), ansatt-tall over tid, antall rapporter generert, datakvalitet-trend (`scored_dimensions/total`).
- Detaljside grupperer alle rapporter for et domene og viser den nyeste som hovedvisning, med tidslinje under.
- Hvis samme dimensjon går fra `insufficient_data` til `sourced` over tid, vises det som "Datakvalitet forbedret" i historikken.

---

## Plan

### 1. Database — `employer_reports`

Én rad per innsending. RLS: alle leser, kun service role skriver. Domene normaliseres (lowercase, strip `www.`, `https://`, path) for treffsikker historikk-aggregering.

```text
employer_reports
  id                          uuid pk
  report_id                   uuid unique          -- klient-generert, idempotens
  submitted_at                timestamptz
  schema_version              text

  language                    text
  tier                        text                 -- 'standard' | 'extended'

  company_name                text
  company_domain              text                 -- normalisert, index
  branch_country              text
  parent_country              text
  analysis_date               date

  employee_count              int
  employee_count_source       text
  employee_count_as_of        date
  revenue_bucket              text
  industry_nace               text

  overall_score               numeric(3,2)
  scored_dimensions           int
  total_dimensions            int

  dimensions                  jsonb                -- ALLE 8: { name, score|null, label, source_count }
  source_count                int
  search_count                int
  scope_deviation             boolean

  ingest_ip_hash              text                 -- sha256(ip|dato), kun rate-limit
  created_at                  timestamptz default now()

indexes:
  (company_domain)
  (lower(company_name))
  (submitted_at desc)
  (company_domain, submitted_at desc)              -- historikk-spørringer
  (branch_country)
  unique(report_id)

RLS:
  SELECT for anon + authenticated
  INSERT/UPDATE/DELETE blokkert (kun service role)
```

### 2. Mottak — `src/routes/api/public/ingest-report.ts`

TanStack public route (POST + OPTIONS). Tar imot payload fra skillen og lagrer via `supabaseAdmin`.

- Zod-validering: alle 8 dimensjoner krevd (eller eksplisitt `score: null` + `label: "insufficient_data"`), score 0–5, tier-/språk-whitelist, lengdebegrensninger.
- Aksepterer både `schema_version` 1.0 og 1.1 (employee-felter er optional).
- Header-gate: `apikey`/`Authorization` Bearer-token må matche en delt nøkkel (lavfriksjons-gate, ikke hemmelig).
- Domene-normalisering, idempotens på `report_id` (insert ignorerer duplikater).
- Soft rate-limit på `sha256(ip|YYYY-MM-DD)`.
- CORS `*` + OPTIONS preflight.
- Returnerer `200 { ok: true, id }`, `400 { error }`, `401`, `409 { ok: true, deduped: true }`, `429`.

### 3. Oppdater skill v1.3.0 og re-bundle

Endringer i `/tmp/skill.zip` før vi base64-bundler på nytt:

- **`config.json`** — sett `supabase_endpoint` til `https://karrierenmin.no/api/public/ingest-report` og `supabase_anon_key` til den delte nøkkelen.
- **`scripts/submit_report.py`**:
  - Generer `report_id = str(uuid.uuid4())` per kjøring.
  - Utvid `_strip_to_anonymous_payload` til å inkludere `employee_count`, `employee_count_source`, `employee_count_as_of`, `revenue_bucket`, `industry_nace`, samt `report_id`.
  - Sørg for at alle 8 dimensjoner alltid sendes (også de uten data — med `score: null`).
  - Bump `SCHEMA_VERSION = "1.1"`.
- **`SKILL.md`** — oppdater "Consent and submission"-blokken som vises til brukeren før innsending. Foreslått tekst (kortet ned i implementasjon):

  > **Hva sendes til karrierenmin.no?**
  > Når denne rapporten er ferdig, sender skillen et anonymt sammendrag til
  > **Analysedatabasen** på karrierenmin.no. Dette bygger en åpen, voksende
  > kunnskapsbase som alle brukere drar nytte av.
  >
  > **Det som sendes:**
  > • Selskapsnavn, domene, land og bransje
  > • Analyse-dato, språk og rapport-tier (standard/utvidet)
  > • Totalscore og score per dimensjon (1.0–5.0, eller "ikke nok data")
  > • Antall ansatte og omsetnings-bøtte (når tilgjengelig fra offentlige registre)
  > • Antall kilder og søk brukt
  >
  > **Det som IKKE sendes:**
  > • Ditt navn, e-post, IP eller annen brukerinformasjon
  > • Selve PDF-en
  > • Hva du har søkt på eller hvilke kilder skillen valgte
  >
  > **Hvordan brukes dataene?**
  > Aggregerte resultater vises offentlig i **Analysedatabasen** på
  > karrierenmin.no/selskapsanalyse/analysedatabase slik at andre jobbsøkere kan
  > se hvordan selskapet vurderes og hvordan vurderingen endrer seg over tid.
  > Ingenting kobles til deg.
  >
  > Vil du sende rapporten til Analysedatabasen? [Ja / Nei, behold lokalt]

- **`CHANGELOG.md`** — ny `[1.3.0]`-blokk som dokumenterer schema 1.1-feltene og consent-teksten.
- **`INSTALL.md`** — oppdatert beskrivelse av hvilke felter som sendes.

Etter endringer: zip → base64 → overskriv `src/server/skill-bundle.ts`.

### 4. Frontend — Analysedatabase (`/selskapsanalyse/analysedatabase`)

**Listeside:** `src/routes/selskapsanalyse.analysedatabase.index.tsx`

- Header + Footer (samme look som `/selskapsanalyse`). Sidetittel: **"Analysedatabase"**.
- **Søkefelt** med live-filter (debounced 250ms) på `company_name` (ILIKE) og `company_domain`.
- **Filter-chips:** land, tier, språk, bransje (NACE-gruppert), størrelsesbøtte (basert på `employee_count`).
- **Sortering:** nyeste / høyest score / flest rapporter / størst selskap.
- **Resultatkort** (grid på desktop, stack på mobil) viser:
  - Selskapsnavn + domene + favicon
  - Land, språk-flagg, tier-badge
  - Stor overall score med fargekode
  - **8 mini-bars for hver dimensjon** — grå når `score: null`
  - Datakvalitet-pille: `7/8 dimensjoner scoret`
  - Ansatt-tall hvis kjent (`~ 12 400 ansatte`)
  - "n rapporter for dette selskapet" (aggregering på domene)
- Paginering 24 per side. Empty state, loading skeletons.
- SEO-`head()`: title "Analysedatabase — Karrierenmin.no", meta description om felles arbeidsgiver-database.

**Detaljside:** `src/routes/selskapsanalyse.analysedatabase.$id.tsx`

- Brødsmule: Selskapsanalysen › **Analysedatabase** › {selskap}.
- Selskapshode (navn, domene-lenke, land, analysedato, språk, tier, ansatt-tall, bransje).
- **Radar** for de 8 dimensjonene (gjenbruker `DimensionsRadar` — utvides til å akseptere props og rendre `null`-dimensjoner som stiplet linje).
- **Dimensjonstabell** med score, label-status (Sourced / Partial / Ikke nok data), antall kilder.
- Meta-stripe: totalscore, kilder, søk, scope-deviation.
- **Historikk-seksjon** (når flere rapporter finnes for samme `company_domain`):
  - Tidslinje med overall-score over tid (linjegraf).
  - 8 sparklines (én per dimensjon) som viser score-utvikling.
  - Ansatt-tall over tid hvis vi har flere observasjoner.
  - Liste over alle tidligere rapporter (dato, tier, språk, totalscore) med lenke.
- "Generer din egen rapport" CTA tilbake til `/selskapsanalyse`.

**Navigasjon:**
- Lenke **"Analysedatabase"** i `Header` (ved siden av "Arbeidsgiveranalysen").
- Teaser-seksjon nederst på `/selskapsanalyse` med overskrift "Utforsk Analysedatabasen", 3 ferskeste rapporter + lenke til `/selskapsanalyse/analysedatabase`.

### 5. Admin-utvidelse

Boks på `/admin` med tittel "Analysedatabase": totalt antall rapporter, siste 7 dager, topp 5 mest analyserte domener, fordeling per land/tier.

---

## Tekniske detaljer

**Endepunkt-kontrakt:**

```text
POST https://karrierenmin.no/api/public/ingest-report
Headers:
  Content-Type: application/json
  Authorization: Bearer <SKILL_INGEST_KEY>
  apikey: <SKILL_INGEST_KEY>
  X-Schema-Version: 1.1
Body:
  schema_version, submitted_at, report_id (uuid), language, tier,
  company { name, domain, branch_country, parent_country, analysis_date,
            employee_count?, employee_count_source?, employee_count_as_of?,
            revenue_bucket?, industry_nace? },
  overall { score, scored_dimensions, total_dimensions },
  dimensions [8 stk] { name, score|null, label, source_count },
  source_count, search_count, scope_deviation

→ 200 { ok: true, id: "uuid" }
→ 409 { ok: true, deduped: true, id: "uuid" }     -- samme report_id sett før
→ 400 { error: "validation_failed", details }
→ 401 { error: "invalid_key" }
→ 429 { error: "rate_limited" }
```

**Filer som opprettes:**
- `supabase/migrations/<ts>_employer_reports.sql` — tabell, indexer, RLS.
- `src/routes/api/public/ingest-report.ts` — POST + OPTIONS handler.
- `src/lib/reports.functions.ts` — `listReports({ search, country, tier, language, industry, size, sort, page })`, `getReport({ id })`, `getReportHistory({ domain })`, `getReportStats()`.
- `src/lib/normalize-domain.ts` — felles helper (mottak + UI-søk).
- `src/routes/selskapsanalyse.analysedatabase.index.tsx` — listeside.
- `src/routes/selskapsanalyse.analysedatabase.$id.tsx` — detaljside.
- `src/components/selskapsanalyse/ReportCard.tsx`, `ScoreBadge.tsx`, `DimensionMiniBars.tsx`, `ScoreTimeline.tsx`, `DimensionSparkline.tsx`.

**Filer som endres:**
- `src/server/skill-bundle.ts` — ny base64 etter re-zip av v1.3.0.
- `src/components/selskapsanalyse/DimensionsRadar.tsx` — aksepterer props, håndterer `null`-dimensjoner.
- `src/components/landing/Header.tsx` — lenke "Analysedatabase".
- `src/routes/selskapsanalyse.index.tsx` — teaser-seksjon "Utforsk Analysedatabasen".
- `src/routes/_authenticated/admin.index.tsx` — "Analysedatabase"-statistikkboks.
- `src/routes/sitemap[.]xml.ts` — `/selskapsanalyse/analysedatabase`.

**Personvern:**
- Skill-payloaden inneholder bevisst ingen PII (kode-inspeksjon av `_strip_to_anonymous_payload` bekrefter — kun selskaps-/rapportdata).
- Brukeren av skillen ser eksplisitt consent-tekst (over) før innsending, og kan velge "Nei, behold lokalt".
- IP hashes med dato-salt — kun for rate-limit, regenereres ved dato-rull.
- Den offentlige delte nøkkelen i `config.json` er ikke hemmelig; hovedforsvar er Zod + rate-limit + RLS.
- Analysedatabasen viser kun selskaps-/rapportdata.

**Implementasjons-rekkefølge:**
1. Migrasjon for `employer_reports` (godkjennes av deg).
2. Public ingest-route + `reports.functions.ts`.
3. Frontend list- og detaljside for Analysedatabasen + komponenter.
4. Oppdater `DimensionsRadar` til å være konfigurerbar.
5. Header-lenke + teaser + admin-boks.
6. Re-bundle skill v1.3.0 (oppdatert `submit_report.py`, `config.json`, `SKILL.md`-consent med "Analysedatabase"-navn, `CHANGELOG.md`).
7. End-to-end-test: kjør skillen lokalt mot prod-endepunktet, se raden i Analysedatabasen.
