## Mål

Port mønsteret fra AccountAngleAgent inn i `/selskapsanalyse`:
1. Etter at brukeren har sendt skjemaet, må de koble seg med Henrik Vaage på LinkedIn **og/eller** følge karrierenmin.no før nedlasting låses opp.
2. Send en e-post med nedlastingslenke og informasjon om at de vil høre fra oss når nye verktøy lanseres.
3. Admin-side med oversikt over e-postlisten.
4. Automatisk avmelding for mottakere.

Beholder Lovable Emails (allerede satt opp) i stedet for å flytte inn Mailjet — samme resultat, mindre kode. Avmelding er allerede innebygd i Lovable Emails via `email_unsubscribe_tokens` og `/unsubscribe`-ruten.

---

## 1. Database (migration)

Utvider `leads`-tabellen og legger til hendelsessporing + admin-rolle.

```text
leads:
  + access_token       uuid   default gen_random_uuid()  unique
  + email_sent_at      timestamptz
  + connect_clicked_at timestamptz
  + follow_clicked_at  timestamptz
  + downloaded_at      timestamptz

lead_events (ny):
  id, lead_id (fk leads), event_type text, event_meta jsonb, created_at

app_role enum + user_roles tabell + has_role() funksjon
  (følger user-roles-mønsteret i prosjektreglene)

RLS:
  - leads / lead_events: kun service_role (eksisterende mønster)
  - user_roles: bruker kan lese egne, admin kan lese alle
```

Eksisterende `consent_marketing`-kolonne brukes som "ja takk til nyhetsmail". Suppression-listen + unsubscribe-token-systemet finnes allerede.

## 2. LinkedIn-gating UI

Ny rute `src/routes/selskapsanalyse.takk.tsx` (`/selskapsanalyse/takk`):
- Tar imot `?token=<access_token>` fra LeadForm-redirect.
- Viser to LinkedIn-CTA:
  - **Koble til Henrik Vaage** → `https://www.linkedin.com/in/henrikvaage`
  - **Følg karrierenmin.no** → `https://www.linkedin.com/company/karrierenmin/?trk=follow`
- Klikk på én av dem (a) sporer hendelsen via `trackLeadEvent` server-fn, (b) lagrer unlock-state i `localStorage` (`km_skill_unlocked_v1`), (c) avslører nedlastingsknapp for `.skill`-filen.
- UTM-parametere på utgående LinkedIn-lenker for å skille kanal.

`LeadForm` endres til å redirige til `/selskapsanalyse/takk?token=...` i stedet for å vise nedlastingsknapp inline.

## 3. Server functions

Utvider `src/lib/leads.functions.ts`:
- `submitLead` returnerer nå `{ ok, accessToken }` (henter `access_token` fra insert), og håndterer dup-email ved å returnere eksisterende token.
- Ny `trackLeadEvent({ accessToken, type: 'connect_click' | 'follow_click' | 'download' })` som logger til `lead_events` og setter relevant timestamp på `leads`.

## 4. E-postmal (Lovable Emails)

Oppdaterer `src/lib/email-templates/selskapsanalyse-bekreftelse.tsx`:
- Nedlastingsknapp (samme `DOWNLOAD_URL` som i dag).
- Eksplisitt seksjon: "Følg karrierenmin.no på LinkedIn — vi sender deg en kort e-post når vi lanserer nye verktøy som dette."
- LinkedIn-følg-CTA-knapp.
- Avmeldings-footer legges til automatisk av Lovable Emails — vi rører ikke den. Den peker på eksisterende `/unsubscribe`-side som allerede er bygget.

`consent_marketing`-checkboxen i `LeadForm` blir tydeligere merket og default avhuket (brukeren får uansett bekreftelsesmail; opt-in styrer kun fremtidige produktnyheter).

## 5. Admin-side: e-postliste

Ny beskyttet rute `src/routes/_authenticated/admin.leads.tsx`:
- `beforeLoad` kaller server-fn `requireAdmin` (sjekker `has_role(auth.uid(), 'admin')`).
- Lister leads med samme stat-cards som AccountAngleAgent (total / e-postet / lastet ned / klikket connect / opt-in til markedsføring).
- "Export CSV"-knapp.
- Lenke i admin-navigasjon.

Server-fn `getAdminLeads` i ny `src/lib/admin.functions.ts` med `requireSupabaseAuth` + admin-rolle-sjekk.

Første admin-bruker legges til via manuell insert i `user_roles` etter at du har logget inn (jeg gjør det for `hvaage@gmail.com` etter migration).

## 6. Avmelding

Bruker eksisterende infrastruktur uendret:
- Footer-lenke i alle utgående e-poster → `/unsubscribe?token=...`
- `/unsubscribe`-siden + `/email/unsubscribe`-API-ruten er allerede satt opp av Lovable Emails-skaffoldingen.
- Avmeldte e-poster havner i `suppressed_emails` og blir automatisk hoppet over ved fremtidige sendinger.

---

## Filer som endres / opprettes

**Endres**
- `src/components/selskapsanalyse/LeadForm.tsx` — redirect til /takk i stedet for inline download
- `src/lib/leads.functions.ts` — returnerer accessToken, ny trackLeadEvent
- `src/lib/email-templates/selskapsanalyse-bekreftelse.tsx` — LinkedIn-CTA + nyhetsbrev-løfte
- `src/routeTree.gen.ts` — auto

**Nye**
- `src/routes/selskapsanalyse.takk.tsx` — LinkedIn-gate + download
- `src/routes/_authenticated/admin.leads.tsx` — admin lead-liste
- `src/lib/admin.functions.ts` — getAdminLeads (+ requireAdmin helper)
- Migration: leads-kolonner, lead_events-tabell, app_role + user_roles + has_role
