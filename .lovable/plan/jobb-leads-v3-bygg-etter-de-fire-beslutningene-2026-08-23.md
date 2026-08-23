# Jobb-Leads v3 — bygg etter de fire beslutningene

De fire beslutningene er lagt til grunn. Én ting i Fase 0 lar seg ikke bygge slik den er
formulert, og det er avklart nedenfor før noe annet.

## Fase 0: `cv_evidence_atoms` er droppet — `career_atoms` er evidensgrunnlaget

Historikken er notert: `cv_evidence_atoms` var en egen, tom tabell som ble droppet 15. august
samme dag `career_atoms` ble opprettet. Det endrer ikke Fase 0.


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
4. **Rett skriveveien for manuell registrering før filteret skrus på.** Funnet er verifisert i
   koden: `upsertEvidenceAtom()` (`src/lib/queries/career-atoms.ts`, `common`-objektet linje
   294–309) setter hverken `confidence` eller `user_confirmed`, og `UpsertEvidencePayload` har
   ikke feltet. `source_type` defaulter til `'manual'` i samme funksjon. Uten rettelsen blir alt
   som legges inn under «Min karriere» permanent usynlig for matching.
   - `upsertEvidenceAtom()`: i `common`, sett `confidence: 'verified'` og `user_confirmed: true`
     når `source_type` er `'manual'`. Beregnes én gang fra `payload.source ?? "manual"` slik at
     et eksplisitt ikke-manuelt kall ikke får bekreftelsen gratis.
   - `insertCareerAtomFields()` (`src/lib/atom-explicit-writes.ts`): sett
     `user_confirmed: fields.source_type === 'manual'` — ikke hardkodet `true`, siden funksjonen
     er ment som fellesfunksjon også for importbaserte skriveveier senere. (Funksjonen er i dag
     ubrukt; rettes defensivt.)
   - Ingen endring for import- og KI-forslag: de går fortsatt via `cv_parse_candidates` og blir
     `user_confirmed` bare ved eksplisitt bekreftelse der.
5. **Engangsoppdatering av eksisterende data — allerede talt: 0 rader berøres.**
   Telling i databasen nå viser at det ikke finnes én eneste rad med `source_type='manual'`.
   Hele evidensbestanden er 74 + 1 `old_cv_pdf` og 3 `user_input`, alle med
   `confidence='verified'`. Den ene `user_confirmed=false`-raden er `old_cv_pdf` (inaktiv, derfor
   utenfor de 77 aktive) og skal ikke røres — den er importert, ikke manuell.
   Oppdateringen (`atom_kind='evidens'`, `source_type='manual'`, `user_confirmed=false`
   → `user_confirmed=true`, `confidence='verified'`) kjøres likevel som del av Fase 0, og
   radtallet rapporteres på nytt etter kjøring i tilfelle noe er lagt inn i mellomtiden.
   Merk: dagens manuelle CV-gjennomgangsvei skriver `source_type='user_input'` og setter allerede
   `user_confirmed: true` selv, så den er upåvirket.
6. **Terskelmålingen — oppfylt med god margin.** 5 brukerkontoer totalt, 2 har evidensatomer,
   og begge (100 %) beholder grunnlaget etter innstrammingen. Alle 77 aktive evidensatomer har
   allerede `user_confirmed=true`; null aktive ubekreftede. Filterendringen er et no-op på dagens
   data og kan ikke tømme evidensgrunnlaget for noen. Terskelen på 20 % er dermed klarert.
7. **Fase 0 er ferdig først når punkt 4–6 er gjennomført og talt på nytt.** Deretter gjenstår
   én verifikasjon før Trinn C: rescore et representativt utvalg NAV/Careerjet-rader mot v4 og
   sammenlign status og score mot v3-resultatet.



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
