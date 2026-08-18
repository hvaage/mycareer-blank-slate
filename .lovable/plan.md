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

## 5. Arbeidsgiverdokumenter — datamodell og RLS (korrigering 6)

Ny tabell `employer_source_documents`:
- `id`, `user_id`, `document_id` (peker til `documents`, filen lagres der), `kind` (medarbeidersamtale, 1-til-1, KSO, OKR, salgsmål, prosjektbeskrivelse, kvartalsmål, årsbudsjett, annet), `employer`, `role_atom_id` (nullbar), `period_start`, `period_end`, `objective_text`, `result_text`, `result_value`, `result_unit`, `provenance` (`documented` når verdien står i dokumentet, `user_attested` når brukeren skriver den selv), `content_hash`, `version`, `source_locator` (side/avsnitt/sitat), `ai_processing_consent` (default false), `created_at`, `archived_at`.
- RLS: alle policyer scoper på `auth.uid() = user_id`; ingen anon-tilgang. GRANT til `authenticated` og `service_role`.
- Ingen trigger oppretter `career_atoms`. Dokumentet produserer **kandidater** som må gjennom Gjennomgå forslag.
- Manuelt innskrevne mål/resultat lagres som `user_attested`, aldri som `documented`.
- Et dokument kan knyttes som **belegg til et eksisterende atom** (via `career_atom_links` / evidensprojeksjonen) uten å opprette et nytt atom — gjennomgangen tilbyr «Styrk eksisterende resultat» før «Opprett nytt».
- Konfidensielle dokumenter sendes ikke til AI før brukeren aktivt har huket av samtykke per dokument; uten samtykke er kun manuell registrering mulig.

## 6. Dokumentlivssyklus (korrigering 7, 8, 9, 10)

Steg 1 — kartlegging (ingen UI-endring): fastslå eksakt hvor hvert dokument bor i dag (`documents`, `cv_imports`, `profiles.cv_*_path`).

Steg 2 — servereid kontrakt: én kanonisk katalog som server-side view/RPC (`user_documents_v1`) med feltene `document_id`, `title`, `doc_type` (kilde-cv, generell cv, stillingstilpasset cv, søknadsbrev, arbeidsgiverdokument, annet), `origin` (opplastet, generert, importert), `status` (aktiv, arkivert), `usage_eligibility` (`source_only` | `submittable`), `provenance` (import-id, generasjons-id, hash), `stable_url`. Frontend slutter å slå sammen paths selv; `cv-archive-sources.ts` bygges om til å lese katalogen.

Steg 3 — Min dokumentasjon blir arkivet for alt: kilde-CV-er og kildedokumenter, generelle CV-er, stillingstilpassede CV-er, søknadsbrev. Søknader forblir produksjonsflaten.

Steg 4 — vedleggsvelgeren i søknader filtrerer på `usage_eligibility = 'submittable'` **i spørringen/serverkontrakten**, ikke via badge. Kilde-CV-er kan teknisk ikke velges som vedlegg.

Steg 5 — sletting: standardhandlingen heter **Arkiver**. Permanent sletting krever konsekvensoppslag («dette dokumentet belegger N elementer i karriereoversikten») og eksplisitt bekreftelse, etter samme mønster som `career_atom_delete_impact`.

## 7. Risiko

- **Dubletter:** samme rolle/resultat fra CV og arbeidsgiverdokument. Motvirkes av «Styrk eksisterende» før «Opprett nytt» og av `content_hash` per dokumentversjon.
- **Tap av provenance:** hvis kandidater opprettes uten `source_locator` mister vi sporbarheten. Ingen kandidat lagres uten kilde-id, versjon og sitat/lokator.
- **Feil vedlegg:** kilde-CV sendt som søknadsvedlegg. Motvirkes av serverfiltrert vedleggsvelger.
- **Brutte gjennomganger:** motvirkes av redirects med bevart importkontekst.
- **Uønsket AI-eksponering:** motvirkes av samtykkeflagg per dokument.

## 8. Inkrementell rekkefølge med testpunkter

1. **Min profil + meny (frontend).** Test: statusstripen viser riktig status for en bruker med og uten data; alle gamle lenker treffer riktig side.
2. **Legg til kilder / Gjennomgå forslag — omdøping og ruting.** Test: pågående CV-gjennomgang gjenopptas fra gammel og ny URL på riktig trinn.
3. **Dokumentkatalog (servereid kontrakt).** Test: katalogen returnerer samme dokumenter som dagens visninger, og vedleggsvelgeren viser ingen kilde-CV.
4. **Arkivering + konsekvensbasert sletting.** Test: sletteforsøk på dokument med avhengigheter viser konsekvens og blokkerer utilsiktet tap.
5. **Arbeidsgiverdokumenter: tabell + RLS + registrering.** Test: RLS-lesing på tvers av brukere feiler; ingen `career_atoms` opprettes automatisk.
6. **Arbeidsgivergjennomgang i innboksen.** Test: dokument kan både styrke eksisterende resultat og opprette nytt, med korrekt `provenance`.
7. **LinkedIn- og kvalifikasjonsflyter.** Test: kompetanse fra LinkedIn kan ikke bekreftes uten kobling til rolle eller resultat.

Ingen kode, tabeller eller navigasjonsendringer gjennomføres før denne planen er godkjent.
