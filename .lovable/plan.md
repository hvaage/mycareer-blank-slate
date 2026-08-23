# Jobb-Leads v3 — bygg etter de fire beslutningene

De fire beslutningene er lagt til grunn. Én ting i Fase 0 lar seg ikke bygge slik den er
formulert, og det er avklart nedenfor før noe annet.

## Blokkerende avklaring i Fase 0: `cv_evidence_atoms` finnes ikke i dette prosjektet

Verifisert mot databasen: det finnes ingen tabell `cv_evidence_atoms` i karrierenmin.no.
Evidenstabellen her er `career_atoms` (karriereontologi v4), og den er allerede resultatet av
LinkedIn-import, CV-import og «Om meg»/«Min karriere» — altså nøyaktig det evidensgrunnlaget
beslutningen beskriver, men under et annet navn. Kommentaren i
`score-pending-opportunities/index.ts` (linje 520–521) sier det eksplisitt: «career_atoms er
eneste evidenskilde. user_evidence_atoms og cv_evidence_atoms leses ikke lenger her.»
`cv_evidence_atoms` var navnet i det gamle skjemaet og i skill-dokumentasjonen; overgangen bort
fra det er allerede gjennomført.

`career_atoms` har feltene beslutningen forutsetter: `atom_type`, `content_no`, `content_en`,
`source_quote`, `confidence`, `attestation`, `user_confirmed`, samt `atom_kind='evidens'`.

**Svar på spørsmålet om supersedert/slettet evidens:** `career_atoms` bruker ikke sletting.
Utgått evidens markeres med `is_active=false`, og i tillegg finnes `state`, `valid_from`/`valid_to`
og `stale_at` for tidsavgrensning og foreldelse. Filteret `is_active=true` må derfor **beholdes** —
uten det scores brukeren mot tilbakekalt og supersedert evidens.

**Konsekvens for Fase 0:** ingen tabellbytte. Det reelle innholdet i beslutningen — «kun bekreftet
evidens skal brukes» — gjennomføres som en filterendring.

## Fase 0 — Stram inn evidensgrunnlaget (gjøres og verifiseres først)

1. I `loadProfileAndEvidence()`: bytt `.order("user_confirmed", …)` med
   `.eq("user_confirmed", true)`. `is_active=true` og `atom_kind='evidens'` beholdes.
   Ubekreftet og `inferred` evidens brukes dermed ikke til matching, i tråd med
   evidensprinsippet.
2. `EvidenceItem`-formen er allerede `ref`/`category`/`label`/`description`. `ref`-prefikset
   settes til `ca:<id>` og `evidence_basis.source` beholdes som `career_atoms` (faktisk kilde).
3. Bump `MATCH_SCORE_VERSION` til `job_match_v4_2026_08_23`, flytt
   `job_match_v3_2026_08_15` til `MATCH_SCORE_VERSION_LEGACY`, og legg den nye strengen inn i
   `ACCEPTED_MATCH_SCORE_VERSIONS` i `job-leads.tsx`.
4. Verifikasjon før Trinn C startes: tell hvor mange brukere som mister evidensgrunnlag helt
   (får `evidence_basis.status='empty'`) ved det strammere filteret, og rescore et representativt
   utvalg NAV/Careerjet-rader mot v4 med sammenligning mot v3-resultatet.

## Trinn A — Datamodell

- `job_leads` utvides additivt: `qualification_status`, `qualification_score`,
  `qualification_reason`, `application_due`, `raw_payload`, `parse_confidence`, `reject_reason`.
- **Ingen ny identitetsnøkkel.** De to eksisterende unike indeksene beholdes uendret:
  `idx_job_leads_dedupe (user_id, coalesce(job_url), coalesce(title), coalesce(company))` er
  upsert-nøkkelen ved inntak, og `job_leads_source_url_hash_idx (user_id, source_system,
  source_url_hash) WHERE source_url_hash IS NOT NULL` er kildenøkkelen. Der en tekstlig
  kryss-kildenøkkel trengs, brukes `normalize_lead_key()` og `lead_dedupe_keys`.
- Nye tabeller `imported_job_emails` (rå e-post, egen oppbevaringstid) og `email_job_sources`
  (kilde, søkefilter, aktiv-status), begge: `CREATE TABLE` → `GRANT` → `ENABLE ROW LEVEL
  SECURITY` → egne policyer per operasjon på `auth.uid()`, samme mønster som `job_leads`.
- `email_connections` finnes allerede med `provider`-enum og tokenfelter og gjenbrukes uendret.

## Trinn B — Inntak og parsing

- **Én parser-modul** for både Finn og LinkedIn: prefilter → faste selectors per kilde →
  AI-fallback kun for e-poster ingen selector treffer → konfidens og `reject_reason`.
  Gjelder kun e-postkildene; NAV og Careerjet er strukturerte feeder uten tekstparsing.
- **Gmail og Outlook bygges parallelt bak samme abstraksjon** (`connect`, `listSince`,
  `fetchMessage`, tokenfornyelse), med `last_synced_internal_date` som inkrementell markør.
  `EmailConnections`-stubben erstattes med reell tilkoblingsflate for begge.
- **Videresending som tredje vei**, med tjeneste navngitt før bygging. Anbefaling: Mailjet
  inbound parse, siden Mailjet allerede er utgående e-postleverandør i prosjektet — én leverandør,
  ett domene, ingen ny avtale. Mottak via `/api/public/inbound/job-email`, med:
  signaturverifisering fra leverandøren, ugjettbart alias (tilfeldig token, ikke bruker-id),
  rate-limiting per alias og per IP, og hard størrelsesgrense per melding.
- Skriving til `job_leads` bruker det eksisterende status-enumet (`ny`, `avvist`, `promotert`,
  `arkivert`) og setter `source_system` + `source_url_hash`.
- **Eneste påkrevde UI-endring:** i `job-leads.tsx` (~linje 341) er `source: "linkedin"` hardkodet
  for alle `job_leads`-rader. Les `source_system` og map til riktig etikett, og utvid
  kildefilteret med `finn`.

## Trinn C — Lik matching for alle fire kilder

Forutsetter at Fase 0 er verifisert.

- `job_leads` legges inn som tredje kandidatkilde i `loadCandidates()`, sidestilt med
  `user_opportunities` og `user_job_listing_status`. Samme `initialScreening()` og samme
  AI-evaluering, ingen egen logikk for e-postkilder.
- Ufullstendig annonsetekst i `posted_text`/`raw_snippet` håndteres av den eksisterende
  `insufficient_job_text` / `description_complete`-mekanismen i `screening-v2.ts`.
- Registrering i `lead_dedupe_keys` flyttes til innhentingstidspunktet, innført samtidig for
  alle fire kilder — ikke bare e-post.

## Trinn D — Drift

- Ny innhentingsfunksjon bruker samme «tomt vs. feilet vs. delvis»-responsmønster som
  `score-pending-opportunities` og `fetch-careerjet-listings`.
- Helsemål: andel `avvist` per `reject_reason` per kilde over tid.
- Daglig jobb arkiverer leads med passert `application_due`.
- Rå e-posttekst får kortere oppbevaringstid enn det strukturerte resultatet; samtykketeksten
  sier eksplisitt at lesescopet er bredere enn «kun jobbvarsler».

## Rekkefølge
Fase 0 → verifikasjon → Trinn A → Trinn B (Gmail, Outlook og videresending parallelt) →
Trinn C → Trinn D.
