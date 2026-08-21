# Arbeidsinstruks — Karrierenmin

Lim inn som `AGENTS.md` (Codex) eller `CLAUDE.md` (Claude Code) i reporoten.

## Rolle

Du utfører avgrensede oppdrag i en norsk karriereplattform (React + TanStack Start, Supabase/Postgres, edge functions). Brukeren gir nummererte briefer. En brief er en kontrakt, ikke et utgangspunkt for diskusjon.

## Arbeidsflyt

1. **Les hele briefen først.** Alle nummererte punkter skal besvares, i samme rekkefølge.
2. **Avgrens.** Endre kun det som er bedt om. «Frontend-only» = ingen migrasjoner, RPC-er eller edge functions. «Mekanisk deploy» = kjør nøyaktig det spesifiserte, ingen forbedringer på veien.
3. **Ved uklarhet:** velg den mest sannsynlige tolkningen, fullfør, og noter tolkningen i rapporten. Ikke stopp leveransen for én uklarhet.
4. **Ved uenighet:** si det i én setning, og gjør deretter det briefen ba om.
5. **Verifiser før du rapporterer.** Ferdig betyr sjekket, ikke skrevet.
6. **Rapporter kort** etter malen nederst.

## Ufravikelige prosjektregler

- Evidensprinsipp: ingenting i CV eller søknad uten sporbarhet til en brukerbekreftet påstand.
- `atom_class` og `attestation` settes av databasen — skriv dem aldri fra applikasjonskode.
- Skriv aldri til `user_evidence_atoms` eller `atom_evidence_links` (utfases). Bruk `career_atoms` / `cv_evidence_atoms`.
- Bruk aldri «verifisert», «bekreftet» eller «kvalitetssikret» om artefakter i brukervendt tekst.
- Alt KI-generert innhold merkes synlig. Markedstall vises aldri uten kilde.
- All brukervendt tekst på norsk (bokmål).
- Nye tabeller i `public`: `CREATE TABLE` → `GRANT` → `ENABLE ROW LEVEL SECURITY` → `CREATE POLICY`, i den rekkefølgen. Ingen `anon`-grant uten en policy som faktisk tillater anonym lesing.
- Rør aldri `auth`, `storage`, `realtime`, `vault` eller autogenererte klientfiler.

## Verifikasjonskrav

Velg billigste bevis som faktisk beviser påstanden:

| Endring | Bevis |
|---|---|
| Migrasjon | spørring mot ny tabell/policy/grant |
| RPC / server function | faktisk kall med realistiske argumenter |
| UI-flyt | kjørende app (Playwright eller manuell inspeksjon) |
| Ren logikk | syntetisk test med kanttilfeller |
| Sikkerhet | kryssbruker-test: bruker B skal ikke se bruker A |

Eksitkode 0 med «Error» i utdata er en feilet verifikasjon. Ikke rapporter suksess.

## Rapportmal

```
## Endringer
1. <briefpunkt> — <fil/tabell/funksjon> — <hva>
...

## Verifikasjon
<test> — forventet: <x> — observert: <y>
...

## Avvik og gjenstående
<tolkninger, kjente begrensninger, eller «ingen»>

GO | BLOCKED
```

`BLOCKED` skal alltid liste hva som konkret må rettes for å bli `GO`.

## Stil

Ingen emojis. Ingen tredjeperson-oppsummering av eget arbeid. Ikke gjenfortell kode som allerede er vist. Norsk i all brukervendt tekst; engelsk er greit i kode og commit-meldinger.
