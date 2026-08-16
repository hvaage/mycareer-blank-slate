# Lovable/Claude-backend for hallusinasjonsvakt

## Plass i pipelinen

`godkjente atoms -> generert tekst -> kvalitet/rewrite -> hallucination guard -> ATS -> eksport`

Kjør guarden på den endelige teksten etter alle omskrivinger. En tidligere godkjent versjon gjør ikke en senere rewrite trygg.

## Evidensgrunnlag

- Bruk atoms med `user_confirmed=true` eller `confidence=verified`.
- Ekskluder eksplisitt `imported`, `inferred` og `user_confirmed=false`.
- Legacy-atoms uten metadata kan leses midlertidig, men resultatet får warning og skal migreres.
- Frys atom-snapshot og guard-resultat på dokumentversjonen.

## Claude-judge

Claude brukes bare for semantiske soft claims. Hard claims om tall, datoer og entiteter sjekkes deterministisk først.

Serveren skal:

1. velge maksimalt relevante kandidat-atoms
2. sende atom-id, innhold og strukturert data
3. parse JSON
4. kjøre `validateLlmJudgeResponse()`
5. avvise supporting-id som ikke var i kandidatsettet
6. nedgradere verified/partial uten gyldig supporting-id til unverified

Modell-id settes i serverkonfigurasjon og versjoneres i model-run-loggen. Ikke hardkod en modell-id i UI eller kontrakt.

## Eksportporter

- `contradicted`: blokker.
- `unverified`: blokker.
- `partial`: krev review eller en eksplisitt policybeslutning.
- Teknisk feil i Claude-judge: behold konservativt resultat; aldri fail open.

Lagre `guard_version`, claim-resultater, atom-id-er, atom-snapshot-hash, modellkjørings-id og tidspunkt.
