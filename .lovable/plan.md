# Revidert plan: rydde «Min karriere» og innføre kilder som førsteklasses begrep

## 1. Dagens faktiske navigasjon, ruter og dataeiere

Meny «Min karriere» (`src/components/app-sidebar.tsx`):

```text
Min profil              /min-profil
  Om meg                /about-me                 (innrykk)
  Karriereoversikt      /karriere/erfaring        (innrykk)
  Importer eksisterende CV /min-profil/importer-cv (innrykk)
  CV-gjennomgang        /career/cv-review         (innrykk, kun når noe venter)
Min dokumentasjon       /documentation
AI-forslag              /career/atom-review
```

Øvrige ruter i samme område: `/min-profil/karriereretning`, `/min-profil/importgjennomgang` (redirect), `/preferences`, `/documentation/*` (Oversikt, CV-er, Søknadsbrev, Resultater, Kompetanser, Kvalifikasjoner, Case, Andre dokumenter, Dokumentpakker), `/documents/*` (redirect til biblioteket), `/soknadsdokumenter`, `/cv-builder`, `/cover-letters`.

Dataeiere i dag:
- Preferanser og «Om meg»: `profiles` + `user_career_profiles`.
- Bekreftet erfaring: `career_atoms` (+ `career_atom_links`, projeksjonstabeller).
- Kilde-CV: `cv_imports` (fil i bucket `cv-uploads`) → `cv_parse_candidates` → `cv_review_progress` → promotering til `career_atoms`.
- AI-forslag: `atom_enrichment_proposals` / `atom_enrichment_batches`.
- Dokumenter: `documents` (bucket `job-documents`), pluss CV-stier direkte på `profiles` (`cv_no_pdf_path` osv.).

Viktig funn: **det finnes ingen kanonisk dokumentkatalog**. `src/lib/queries/cv-archive-sources.ts` slår i dag sammen profilkolonner og `documents`-rader i frontend, og kilde-CV-er (`cv_imports`) er ikke i `documents` i det hele tatt. `documents` har felter som kan bære en kontrakt (`documentation_category`, `documentation_status`, `visibility`, `confidentiality_level`, `source_context`, `document_group_id`, `cv_variant`), men de brukes ikke konsistent, og det finnes ingen `origin`/`usage eligibility`.

## 2. Ordlyd i brukerflaten

Anbefaling: bruk hverdagsspråk i menyen, behold kildebegrepet i forklaringer og i den tekniske modellen.

| Teknisk begrep | Menytekst |
| --- | --- |
| Kildeimport | **Legg til kilder** |
| Kildegjennomgang | **Gjennomgå forslag** |

Undertekster forklarer begrepet: «Kilder er materialet vi bygger karriereoversikten din fra.»

## 3. Foreslått sluttstruktur

```text
Min karriere
  Min profil          /min-profil        Det du selv oppgir: om deg, ønsket jobb, preferanser
  Karriereoversikt    /karriere/erfaring Bekreftet erfaring, resultater, kompetanse, kvalifikasjoner
  Legg til kilder     /kilder            Tilfør grunnlag
  Gjennomgå forslag   /forslag           Innboks (vises alltid; teller når noe venter)
  Min dokumentasjon   /documentation     Arkivet
Søknader (egen gruppe, uendret)          Produksjon av søknadsklare dokumenter
```

«Om meg» blir en del av Min profil. «AI-forslag» blir en fane i Gjennomgå forslag.

### Min profil (korrigering 1)
Beholder en **kompakt horisontal statusstripe** (Utfylt / Mangler / Trenger gjennomgang) for: Om meg, Karriereretning, Erfaring, Resultater og kompetanse, Kvalifikasjoner, Dokumentasjon. Boksene lenker til stedet der opplysningen eies — ikke til seksjoner lenger ned på samme side. Under stripen: «Om meg»-skjemaet (dagens /about-me). De repetitive seksjonene «Karriereretning», «Karriereoversikt» og «CV og dokumentasjon» fjernes.

### Legg til kilder (korrigering 3 og 4)
To tydelig adskilte grupper:

**Ditt eget grunnlag** (kan belegge påstander)
1. Eksisterende CV — eneste sted for CV-kildeopplasting. Tekst: «Vi bruker CV-en til å bygge karriereoversikten din. Den brukes ikke som vedlegg i søknader.» Ordet «gammel CV» brukes ikke.
2. Arbeidsgiverdokumenter (ny)
3. LinkedIn-eksport
4. Kursbevis og sertifikater

**Referansegrunnlag** (normaliserer og foreslår, belegger ingenting)
5. Yrkes- og kompetansereferanser (ESCO)
6. Utdanningsreferanser

Referansekortene har egen overskrift, dempet visuell vekt og teksten «Foreslår formuleringer og standardnavn. Gir ikke belegg for at du har kompetansen.»

### Gjennomgå forslag (korrigering 5)
Felles innboks som lister ventende arbeid **per kilde** med antall og «Fortsett»-knapp til den flyten kilden krever:
- CV → dagens firetrinnsflyt (uendret).
- Arbeidsgiverdokumenter → egen flyt: rolle, mål, oppnådd resultat, belegg.
- LinkedIn → egen flyt (kompetanser må belegges mot rolle/resultat).
- Kvalifikasjoner/kursbevis → egen, enklere flyt.
- AI-forslag → fane. Kildebaserte forslag grupperes under sin kilde; forslag uten import (f.eks. profilbaserte) beholder en egen «Øvrige forslag»-fane, slik at ingenting forsvinner.

## 4. Flyttes / beholdes / redirects (korrigering 11)

| Fra | Til | Håndtering |
| --- | --- | --- |
| /about-me | /min-profil | Redirect, `tab`-param bevares |
| /min-profil/importer-cv | /kilder | Redirect |
| /min-profil/importgjennomgang | /kilder | Redirect (finnes allerede) |
| /career/cv-review | /forslag/cv | Redirect **med** importkontekst i søkeparam |
| /career/atom-review | /forslag/ai | Redirect |
| /preferences, /min-profil/karriereretning | uendret | Beholdes |

Regel: ingen rute slettes. Gjenopptak av en pågående gjennomgang leser fortsatt `cv_review_progress` og `cv_imports`, som ikke røres — flyttingen er ren rutingsendring. Testpunkt før deploy: start en gjennomgang på gammel URL, deploy, åpne samme URL, bekreft at brukeren lander på riktig trinn med samme import.

## 5. Arbeidsgiverkilder — todelt datamodell og RLS (korrigering 6)

Dokument og evidens skilles i to lag.

**Lag 1 — `employer_source_documents` (kun dokumentmetadata):**
`id`, `user_id`, `document_id` (filen ligger i `documents`), `kind` (medarbeidersamtale, 1-til-1, KSO, OKR, salgsmål, prosjektbeskrivelse, kvartalsmål, årsbudsjett, annet), `employer`, `content_hash`, `version`, `ai_processing_consent` (default false), `archived_at`, `created_at`. Ingen mål, resultater eller atomreferanser her.

**Lag 2 — `employer_source_candidates` (evidensoppføringer):**
`id`, `user_id`, `source_document_id` (null for manuelle), `candidate_kind` (målsetting, resultat, tallverdi, rollekontekst), `objective_text`, `result_text`, `result_value`, `result_unit`, `period_start`, `period_end`, `role_context_text` (fritekst, ikke atom-id), `source_type` (`document_extract` | `user_input`), `source_document_version`, `source_hash`, `source_span` (strukturert: side/avsnitt/offset + sitat), `review_status` (pending, godkjent, avvist), `created_at`.

Kildekrav (korrigering 2):
- `document_extract` krever alltid kilde-dokument-id, dokumentversjon eller hash, og strukturert `source_span` med side/avsnitt/offset og sitat der dette finnes.
- `user_input` krever stabil id for oppføringen, `user_id`, `created_at`, `source_type = 'user_input'` og tydelig provenance i UI. Det lages **aldri** en kunstig `source_span` for manuelt oppgitt innhold; feltet står tomt.

Regler:
- Ett dokument gir mange kandidater.
- `user_attested` brukes **ikke** her. Det begrepet er reservert for eksplisitt attestasjon av en konkret CV-claim via `cv_claim_attestations`. Manuelt innskrevne mål/resultater lagres som `source_type = 'user_input'` med brukerprovenance, gir ikke dokumentert belegg og påvirker ikke claim-attestasjon.
- Dokumentutdrag (`source_type = 'document_extract'`) kan gi dokumentert belegg, men først etter at kandidaten er godkjent i kildegjennomgangen.

- Ingen `role_atom_id` på kildetabellene. Rollekontekst lagres som tekst; rolleplassering og atomlenker skjer utelukkende gjennom kanonisk review-/RPC-flyt (samme mønster som `career_atom_link_decide` / `cv_review_set_role_choice`).
- Ingen trigger eller kode skriver automatisk til `career_atoms`. Godkjenning i gjennomgangen velger enten «Styrk eksisterende» (evidenslenke til eksisterende atom) eller «Opprett nytt» (kandidat → atom via RPC).
- RLS på begge tabeller: alle policyer scoper på `auth.uid() = user_id`; ingen anon-tilgang. GRANT til `authenticated` og `service_role`.
- Konfidensielle dokumenter sendes ikke til AI før samtykke er satt per dokument; uten samtykke er kun manuell registrering mulig.

## 6. Dokumentlivssyklus (korrigering 7, 8, 9, 10)

Steg 1 — kartlegging (ingen UI-endring): fastslå eksakt hvor hvert dokument bor i dag (`documents`, `cv_imports`, `profiles.cv_*_path`).

Steg 2 — servereid katalog `user_documents_v1` (view/RPC) med feltene `document_key` (stabil identitet), `title`, `doc_type` (kilde-cv, generell cv, stillingstilpasset cv, søknadsbrev, arbeidsgiverdokument, annet), `origin` (opplastet, generert, importert), `provenance` (import-id, generasjons-id, hash, versjon) og **to uavhengige statusdimensjoner** (korrigering 1):

`usage_eligibility` — hva dokumentet kan brukes til:
- `source_only` — grunnlag, kan aldri sendes som vedlegg
- `submittable` — kan i prinsippet sendes som vedlegg

`review_or_generation_status` — hvor dokumentet er i prosessen:
- `pending`, `processing`, `review_required`, `ready`, `failed`, `archived`

De to dimensjonene settes uavhengig. Eksempler:
- Importert kilde-CV under gjennomgang: `source_only` + `review_required`
- Ferdig generert CV: `submittable` + `ready`

En kilde-CV mister ikke synlig importstatus fordi den er `source_only`; prosessdimensjonen vises i egen kolonne/badge i Min dokumentasjon.

Begge dimensjoner utledes av faktisk tilstand (`cv_imports`, `cv_atomization_jobs`, `cv_review_progress`, `cv_generation_jobs`, guard/quality-resultat, eksportert fil) — **aldri** av `document_type` alene.

Katalogen dekker kilde-CV-er fra `cv_imports`, eldre `profiles.cv_*_path` og rader i `documents`, og deduplikerer på fil/import slik at samme underliggende fil vises én gang.

Ingen permanent nedlastings-URL lagres eller eksponeres. Katalogen returnerer stabil dokumentidentitet; nedlasting skjer gjennom en autorisert server-funksjon som genererer signed URL ved forespørsel.

Steg 3 — migrering: `documentation/cv.tsx` og `cv-archive-sources.ts` bygges om til å lese katalogen. Det opprettes ingen fjerde parallell dokumentoversikt.

Steg 4 — vedleggsvelgeren i søknader får fra serverkontrakten kun rader med `usage_eligibility = 'submittable'` **og** `review_or_generation_status = 'ready'`. Andre rader er ikke valgbare, ikke bare skjult bak badge.


Steg 5 — sletting: standardhandlingen heter **Arkiver**. Permanent sletting krever konsekvensoppslag («dette dokumentet belegger N elementer i karriereoversikten») og eksplisitt bekreftelse, etter samme mønster som `career_atom_delete_impact`.


## 7. Risiko

- **Dubletter:** samme rolle/resultat fra CV og arbeidsgiverdokument. Motvirkes av «Styrk eksisterende» før «Opprett nytt» og av `content_hash` per dokumentversjon.
- **Tap av provenance:** dokumentekstraherte kandidater uten kilde-id, versjon/hash og strukturert kilde-spenn lagres ikke. Manuelle kandidater krever id, bruker, tidspunkt og `source_type = 'user_input'` — ingen kunstig kilde-spenn.
- **Feil vedlegg:** kilde-CV eller ikke-ferdig CV sendt som søknadsvedlegg. Motvirkes av at serverkontrakten kun returnerer `submittable` + `ready`.
- **Brutte gjennomganger:** motvirkes av redirects med bevart import-/query-kontekst.
- **Uønsket AI-eksponering:** motvirkes av samtykkeflagg per dokument.

## 8. Inkrementell rekkefølge med testpunkter (korrigering 4)

Menyen endres til slutt, ikke først.

1. **Nye ruter bygges** (`/kilder`, `/forslag`, `/forslag/cv`, `/forslag/ai`, «Om meg» inn i `/min-profil`) uten at sidebar røres. Test: nye URL-er svarer og viser riktig innhold; gamle URL-er fungerer uendret.
2. **Redirects med bevart query-/importkontekst.** Test: `/career/cv-review?import=<id>` lander på `/forslag/cv?import=<id>` på riktig trinn; `/about-me?tab=...` bevarer `tab`.
3. **Gjenopptak verifiseres mot data.** Test: `cv_review_progress` for testbrukeren har samme `current_step` og samme import før og etter redirect; ingen ny rad opprettes.
4. **Dokumentkatalogen testes mot faktiske data.** Test: katalogen returnerer dagens kilde-CV-er fra `cv_imports`, eldre `profiles.cv_*_path`-filer og `documents`-rader, uten dubletter, med korrekt `usage_eligibility` og `review_or_generation_status` utledet av faktisk tilstand; en importert CV under gjennomgang viser fortsatt importstatus; nedlasting går via signert URL.
5. **Først når 1–4 er grønne: sidebar byttes** til likeverdige punkter (Min profil, Karriereoversikt, Legg til kilder, Gjennomgå forslag, Min dokumentasjon). «Gjennomgå forslag» vises alltid. Badge/teller starter på `cv_imports` + `cv_parse_candidates` + `atom_enrichment_proposals`, og utvides til alle kildetyper etter hvert som de kommer; telleren bygges som én kildeuavhengig spørring så nye kilder kun legges til i én liste.
6. **Min profil-opprydding** (statusstripe, «Om meg»-innhold, fjerne repetitive seksjoner). Test: riktig status for bruker med og uten data.
7. **Vedleggsvelger + arkivering/sletting.** Test: kun `submittable` + `ready` er valgbar; sletting med avhengigheter viser konsekvens.
8. **Arbeidsgiverkilder: to tabeller + RLS + registrering.** Test: kryssbruker-lesing feiler; ingen `career_atoms` skrives automatisk; `user_input` gir ikke dokumentert belegg.
9. **Arbeidsgivergjennomgang i innboksen.** Test: kandidat kan både styrke eksisterende atom og opprette nytt, alltid via review-/RPC-flyt.
10. **LinkedIn- og kvalifikasjonsflyter (korrigering 3).** Kompetanse med konkret rolle-/resultatbelegg foreslås med belegg og sikkerhetsnivå. Eksplisitt oppgitt LinkedIn-kompetanse uten slikt belegg vises som «Trenger vurdering» / «Begrenset belegg», auto-bekreftes aldri som dokumentert, og brukeren kan bekrefte den som profilkompetanse, korrigere den, knytte rolle/resultat eller tilføre dokumentasjon. Dette er atomgjennomgang, ikke claim-attestasjon, og setter aldri `user_attested`. Test: slik kompetanse er synlig og gjennomgåbar uten kobling, men får aldri status «dokumentert» uten belegg.


Ingen kode, tabeller eller navigasjonsendringer gjennomføres før denne planen er godkjent.

