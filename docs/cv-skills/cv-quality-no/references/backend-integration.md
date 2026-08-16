# Lovable/Claude-backend for språkkvalitet

## Rekkefølge

`atom-basert utkast -> deterministic quality check -> Claude rewrite -> rewrite validation -> hallucination guard -> ATS -> eksport`

Kvalitetsskillen får ikke opprette fakta. En rewrite er aldri ferdig godkjent før den er validert og deretter verifisert av hallusinasjonsvakten.

## Edge Function

Anbefalt funksjon: `improve-cv-text`.

Input skal inneholde original tekst, kontekst, issues, supporting atom-id-er og eksplisitte source claims. Serveren henter atomene selv og gjør ikke atom-id-er fra klienten autoritative.

1. Verifiser bruker og dokumenteierskap.
2. Kjør `checkQuality()`.
3. Bygg `RewriteRequest` med frosset evidens.
4. Kall Claude med prompten i `quality.ts`.
5. Parse `RewriteResponse`.
6. Kjør `validateRewriteResponse()`.
7. Kjør `cv-hallucination-guard` på rewritten_text.
8. Returner original, forslag, endringer, kvalitet og guard-resultat til review.

## Fail closed

Avvis forslaget når:

- tall, datoer eller beløp er fjernet eller lagt til
- supporting atom-id ikke var i input
- source claim mangler i `preserved_claims`
- `introduced_claims` ikke er tom
- `requires_guard` ikke er true
- hallusinasjonsvakten finner unverified eller contradicted

## Norsk semantikk

Ikke bruk denne skillen til dekomponering eller semantisk deduplisering av norske sammensatte ord. Det tilhører `cv-atom-language-no` før atomisering. Kvalitetspasset skal bevare etablerte fagord når en omskriving kan endre betydning.
