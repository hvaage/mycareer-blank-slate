---
name: oppdragsbrief
description: Arbeidsprotokoll for oppdrag i Karrierenmin — hvordan en oppgave skal tolkes, avgrenses, verifiseres og rapporteres. Bruk ved enhver endringsoppgave, backend-deploy, verifikasjon eller når brukeren gir en brief med flere punkter, og når instruksen skal deles med Codex eller Claude.
---

# Oppdragsbrief — arbeidsprotokoll

Formålet er færre, tettere runder: én melding skal gi ferdig, verifisert arbeid uten mellomspørsmål.

## 1. Les briefen som en kontrakt

- Punktnummerering i briefen er leveransekrav. Alle punkter besvares, i samme rekkefølge.
- Skill aldri mellom «bygg» og «verifiser» — en oppgave er ikke ferdig før den er sjekket mot signalet som betyr noe (SQL-spørring, testkjøring, faktisk UI-tilstand).
- Er ett punkt uklart: gjør den mest sannsynlige tolkningen, gjennomfør, og noter tolkningen i sluttrapporten. Ikke stopp hele leveransen for én uklarhet.
- Avvik fra briefen (bedre løsning, skjult blokkering) meldes i én setning — deretter fortsetter arbeidet slik briefen ba om.

## 2. Avgrensning

- Endre kun det som er bedt om. «Frontend-only» betyr ingen migrasjoner, ingen RPC-endringer, ingen edge functions.
- «Mekanisk deploy» betyr: kjør nøyaktig det som er spesifisert, ingen designforbedringer på veien.
- Ikke rydd i tilgrensende kode uten at det er nødvendig for at oppgaven skal virke.

## 3. Faste prosjektinvarianter

Disse gjelder alltid og skal ikke måtte gjentas i hver brief:

- **Evidensprinsipp:** ingenting i CV/søknad uten sporbarhet til en brukerbekreftet påstand.
- `atom_class` og `attestation` settes av databasen — skriv dem aldri fra applikasjonskode.
- Skriv aldri til `user_evidence_atoms` eller `atom_evidence_links`. Bruk `career_atoms` / `cv_evidence_atoms`.
- Bruk aldri ordene «verifisert», «bekreftet» eller «kvalitetssikret» om artefakter i brukervendt tekst.
- Alt KI-generert innhold merkes synlig. Markedstall vises aldri uten kilde.
- All brukervendt tekst på norsk (bokmål).
- Hver ny tabell i `public`: `CREATE TABLE` → `GRANT` → `ENABLE ROW LEVEL SECURITY` → `CREATE POLICY`. Ingen `anon`-grant med mindre en policy faktisk tillater anonym lesing.

## 4. Verifikasjon før rapport

Velg det billigste signalet som faktisk beviser påstanden:

| Endring | Bevis |
|---|---|
| Migrasjon | `read_query` mot ny tabell/policy/grant |
| RPC eller server function | faktisk kall med realistiske argumenter |
| UI-flyt | Playwright eller preview-JS mot kjørende app |
| Logikk uten UI | syntetisk test med kant­tilfeller |
| Sikkerhet | kryssbruker-test: bruker B skal ikke se bruker A |

Eksitkode 0 med «Error» i utdata er en **feilet** verifikasjon.

## 5. Sluttrapport

Kort og etterprøvbar:

1. Hva som ble endret (fil/tabell/funksjon), punktvis mot briefens nummerering.
2. Hva som ble verifisert og hvordan — forventet vs. observert.
3. Kjente avvik, tolkninger og gjenstående arbeid.
4. Avslutt med `GO` eller `BLOCKED` når briefen ber om godkjenningsport. `BLOCKED` skal alltid liste hva som konkret må rettes.

Ingen tredjeperson-oppsummering, ingen emojis, ingen gjenfortelling av kode som allerede er vist.

## 6. Kostnadsdisiplin

- Foretrekk én stor melding med sammenhengende endringer framfor mange små.
- Målrett filsøk: les de filene briefen peker på, ikke hele kodebasen.
- Store kartleggings- og verifikasjonsmatriser kjøres kun når briefen ber om det.

## Portabel versjon

`references/portabel-instruks.md` inneholder samme protokoll formulert frittstående, klar til å limes inn som `AGENTS.md` for Codex eller `CLAUDE.md` for Claude Code.
