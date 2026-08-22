# Fase 5D — Aktivitetsforslag med KI (beslutningsstøtte, ingen automatikk)

## Hva brukeren får

Knappen «Få aktivitetsforslag» blir aktiv på Oversikt, Aktiviteter, selskapsdetalj, kontaktdetalj og mulighetsdetalj.

Flyten er alltid den samme:

1. Brukeren trykker på knappen i en konkret kontekst.
2. Systemet henter kun brukerens egne, autoriserte data for den konteksten og ber modellen om forslag.
3. Forslagene vises som kort med tydelig KI-merking: tittel, begrunnelse, prioritet, foreslått tidspunkt og hvilke objekter forslaget bygger på.
4. Brukeren kan **Godta og opprett**, **Rediger før opprettelse** eller **Avvis**. Ingenting lagres i `next_steps` uten at brukeren bekrefter i den vanlige aktivitetsdialogen.
5. Avviste og godtatte forslag beholdes med status, så samme forslag ikke maser på nytt.

KI oppretter aldri aktiviteter, endrer aldri status, sender aldri meldinger og kontakter aldri noen.

## Avgrensning (bygges ikke nå)

E-post, LinkedIn-meldinger, automatisk oppfølging/statusendring, automatisk LinkedIn-promotering, CV-/søknadsgenerering, arbeidsgiveranalyse og skjult modellfallback.

## Datagrunnlag per kontekst

- **Oversikt:** åpne aktiviteter, aktuelle muligheter, prioriterte selskaper, varme kontakter.
- **Selskap:** selskapet, brukerens relasjon, kontakter, muligheter og aktiviteter ved selskapet.
- **Kontakt:** kontakten, selskapstilknytning, relevante muligheter, aktivitetshistorikk.
- **Mulighet:** stilling, selskap, søknadsstatus, frist, annonserelasjon, dokumentstatus, annonsekontakter, aktivitetslogg.

Alt hentes på serveren med brukerens sesjon. Aldri sendt til modellen: rå LinkedIn-anbefalingstekst, personlige meldinger, annonserings-/klikkdata og inferert LinkedIn-profilering, hemmeligheter/tokens, interne feillogger, andre brukeres data. Felter kortes til et fast, kjent sett før de forlater serveren.

## Teknisk gjennomføring

### Database (additiv migrasjon)

Ny tabell `network_activity_suggestions`:

- `id`, `user_id` (RLS: kun eier), `scope` (`overview` | `company` | `contact` | `opportunity`), `scope_object_id`
- `source_class` = `ai_suggestion` (kolonne med default og CHECK)
- `activity_type`, `title`, `rationale`, `priority`, `suggested_timing` (jsonb), `context` (jsonb med companyId/contactId/opportunityId/applicationId)
- `evidence` jsonb: liste av `{ objectType, objectId, reason }`
- `model_profile`, `model_name`, `prompt_version`, `generated_at`, `correlation_id`
- `status`: `pending_review` | `accepted` | `dismissed` | `superseded` | `failed`, `decided_at`, `created_activity_id` (FK mot `next_steps` med sammensatt (id, user_id))
- GRANT: `SELECT` til `authenticated` (kun via RLS `auth.uid() = user_id`), `ALL` til `service_role`. Ingen `anon`.

RPC-er (SECURITY DEFINER, ingen execute for anon/authenticated, kalles kun fra serverfunksjon med sesjons-ID):

- `network_store_activity_suggestions(p_user_id, p_scope, p_scope_object_id, p_correlation_id, p_model..., p_items jsonb)` — setter tidligere `pending_review` for samme scope til `superseded` og skriver ny batch atomisk.
- `network_decide_activity_suggestion(p_user_id, p_suggestion_id, p_decision, p_activity_id)` — markerer `accepted`/`dismissed`, validerer eierskap på både forslag og aktivitet.

Ingen kobling til CV-evidens eller `user_attested`.

### Server

Ny `src/lib/network-suggestions.functions.ts`:

- `generateActivitySuggestions` (`createServerFn` + `requireSupabaseAuth`): validerer scope+id med zod, henter kontekst via en serveronly-modul (`network-suggestions.server.ts`) som bruker `context.supabase` (RLS som brukeren), bygger minimert prompt, kaller Lovable AI Gateway med `google/gemini-2.5-flash` (fast konfigurert modell, ingen fallback), krever strukturert JSON, validerer strengt med zod, forkaster forslag som peker på objekt-ID-er brukeren ikke eier, lagrer via RPC og returnerer forslagene. Feil lagres som `failed` og gir sanitert feilmelding.
- `decideActivitySuggestion`: `accepted` (med `created_activity_id`) eller `dismissed`.
- Rate-limit: maks N generering per scope per tidsvindu, håndhevet i RPC-en for å holde kostnaden nede.

`p_user_id` kommer alltid fra sesjonen, aldri fra request-body.

### Klient

- Ny komponent `src/components/network/suggestion-panel.tsx`: knapp «Få aktivitetsforslag», lastetilstand, forslagskort med KI-merke, «Godta og opprett» (åpner eksisterende `ActivityDialog` forhåndsutfylt med tittel, type, prioritet og beregnet frist fra `suggestedTiming`), «Avvis», og visning av kildeobjektene som lenker.
- Kobles inn på `/nettverk/oversikt`, `/nettverk/aktiviteter`, `nettverk.selskaper.$id`, `nettverk.kontakter.$id`, `nettverk.muligheter.$id` med riktig scope.
- Fjerner «kommer snart»-tilstanden på Oversikt.
- Bruker `useNetworkAuth` slik at kall kun skjer med gyldig sesjon; feil vises via `NetworkErrorState`.

### Verifikasjon før ferdig

- Zod-validering avviser ugyldig modellsvar uten å skrive noe.
- Forslag med fremmed objekt-ID blir forkastet (syntetisk test med to brukere).
- `accepted` skriver aktivitet kun via eksisterende `network_upsert_activity`, med brukerens bekreftelse.
- Ingen `anon`-grants; ingen RLS svekket.
- Ekte autentisert kjøring på Henriks 23 muligheter: forslag genereres, avvises og godtas uten konsollfeil eller svar ≥ 400.
