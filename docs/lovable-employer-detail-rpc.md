# Lovable handoff: Arbeidsgiverdetalj via RPC

Backendkontrakten er ny:

- `public.get_employer_detail(p_organisasjonsnummer text)`
- Returnerer samme radstruktur som `public.employer_search_v1`
- Tilgang: `authenticated` og `service_role`
- `anon` har ikke execute
- `reg.*`-tabellene skal fortsatt ikke leses direkte fra frontend

## Mål

Fiks `/arbeidsgivere/$orgnr` slik at "Se detaljer" ikke lenger gjør direkte
`.from("employer_search_v1").select("*")`. Det direkte view-oppslaget feiler
for vanlige brukere fordi viewet er `security_invoker` og underliggende
`reg.enheter` er lukket.

## Endring

I `src/lib/queries/employer-insight.ts`:

- Behold types og UI-kontrakt.
- Endre `loadEmployerDetail(orgnr)` til å bruke:

```ts
const { data, error } = await sb.rpc("get_employer_detail", {
  p_organisasjonsnummer: orgnr,
});
```

- RPC-en returnerer liste/array. Bruk første rad:
  - ingen rader => `{ kind: "not_found" }`
  - én rad => `{ kind: "ok", data: row as EmployerDetail }`
- Hvis RPC-en mangler, behold eksisterende `{ kind: "unavailable" }`-håndtering.
- Andre feil skal fortsatt kastes slik at route errorComponent viser feilmelding.

## Forbudt

- Ikke endre SQL, migrasjoner, RLS, grants, Supabase-data eller Edge Functions.
- Ikke gi frontend direkte lesing mot `reg.*`.
- Ikke sett viewet tilbake til security definer fra frontendarbeidet.

## Verifisering

- `npx tsgo --noEmit`
- `npm run build`
- Browser med innlogget bruker:
  - gå fra `/arbeidsgivere` til et søkeresultat med "Se detaljer"
  - detaljsiden rendrer uten `permission denied for table enheter`
  - Network viser RPC `get_employer_detail`
  - Network viser ikke direkte REST-select mot `employer_search_v1`
  - ingen sync/repair/backfill/analyze/score-funksjoner trigges
