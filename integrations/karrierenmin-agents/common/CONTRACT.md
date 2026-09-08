# Karrierenmin — felles backendkontrakt for assistentpakker

Alle fire pakkene (Grok, Claude, ChatGPT/Codex, Gemini) snakker med nøyaktig samme
backend. Ingen leverandør er standard eller anbefalt, og ingen pakke har egne
endepunkter eller egne rettigheter.

Basis-URL settes av brukeren som en offentlig HTTPS-adresse, aldri `localhost`:

```
KARRIERENMIN_BASE_URL = https://<ditt-domene>
```

## 1. Claim (engangsaktivering)

```
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/claim
Content-Type: application/json

{
  "provider": "grok" | "claude" | "openai" | "gemini",
  "setup_code": "XXXX-XXXX-...",
  "capabilities": {
    "background_execution": true|false,
    "scheduled_runs": true|false,
    "email_forward_or_send": true|false
  }
}
```

- `setup_code` hentes av brukeren i Karrierenmin og er gyldig i 15 minutter, én gang.
- Koden normaliseres server-side (bindestreker fjernes, versaler).
- `capabilities` skal rapportere hva assistenten **faktisk** kan gjøre i den aktuelle
  installasjonen. Aldri utled dette fra gratis-/betalt-abonnement. Ukjente eller
  ikke-boolske felter forkastes av backend.
- Alle feil svarer likt (`invalid_claim`). Backend røper aldri om koden var ukjent,
  utløpt, allerede brukt eller knyttet til en annen leverandør.

Vellykket svar inneholder `integration_token` og `token_expires_at`.
Tokenet lagres i plattformens sikre secret-lager der det finnes. Det skal aldri
legges i prompt, logg, README-eksempel eller URL-query.

## 2. Status

```
GET {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/status
Authorization: Bearer <integration_token>
```

Svarer med integrasjonens status, bekreftede capabilities, `effective_mode`
(utledet server-side) og hvilke arbeidsflyter som er tilgjengelige.

## 3. Kjøring

```
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/run
Authorization: Bearer <integration_token>

{ "workflow_kind": "job_import" | "career_log" | "linkedin_ready" }
```

I gjeldende fase svarer backend `not_available` (HTTP 501) fordi ingen
agentutløst kjøring er koblet på ennå. Pakkene skal vise dette som det er,
og aldri fremstille det som en vellykket kjøring.

## Feilkoder

| Kode | Betydning |
| --- | --- |
| `invalid_claim` | Koden kan ikke brukes. Be brukeren lage en ny kode. |
| `rate_limited` | For mange forsøk fra samme kilde. |
| `unauthorized` | Token mangler, er feil signert, har feil audience eller er utløpt. |
| `integration_inactive` | Brukeren har koblet fra. Tilgangen er tilbakekalt. |
| `not_enabled` | Brukeren har ikke slått på arbeidsflyten. |
| `not_available` | Arbeidsflyten finnes ikke som agentutløst funksjon ennå. |
