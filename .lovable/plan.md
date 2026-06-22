# Embed Markedsinnsikt i innlogget layout

## Endring

Opprett én ny rutefil og oppdater sidepanelet til å lenke dit. Ingen andre filer røres.

### Nye/endrede filer

1. **Ny fil:** `src/routes/_authenticated/marked.tsx`
   - `createFileRoute("/_authenticated/marked")`
   - Component rendrer eksisterende `<CareerExplorer />` fra `@/components/market/CareerExplorer` uten kopiering eller modifikasjon.
   - Ingen `head()`-metadata (intern visning, ikke SEO-flate).
   - Ingen egen `beforeLoad` — arver auth-guarden i `_authenticated.tsx`.

2. **Endret:** `src/components/app-sidebar.tsx`
   - I `market`-gruppen: undersiden «Markedsinnsikt» peker fra `/markedsinnsikt` til `/marked`.
   - `matchPrefixes` for Marked-gruppen oppdateres til `["/marked", "/employers"]` slik at deep link til `/marked` aktiverer riktig gruppe og underside (uten å feilmatche `/markedsinnsikt`).

### Uendret

- `src/routes/markedsinnsikt.tsx` (offentlig SEO-rute med canonical/og-tags) er urørt — `/markedsinnsikt` fungerer fortsatt utlogget på samme URL.
- `src/components/market/CareerExplorer.tsx` og alle queries/backend.
- `src/routes/_authenticated.tsx` `beforeLoad`.
- Ingen migrasjoner, Edge Functions eller backend.
- `routeTree.gen.ts` regenereres automatisk av TanStack Router-plugin under build/dev — manuelt urørt.

## Akseptanse

- `/markedsinnsikt` (offentlig): tilgjengelig uten innlogging, ser identisk ut som i dag, beholder canonical/og-metadata.
- `/marked` (innlogget): krever innlogging via eksisterende `_authenticated` guard (redirect til `/login` ved manglende sesjon), rendrer `CareerExplorer` inne i sidepanel-layouten.
- Sidepanelet → «Marked» → «Markedsinnsikt» navigerer til `/marked` og forblir i sidepanellayouten.
- Aktiv gruppe (Marked) og aktiv underside markeres korrekt på `/marked` og `/marked/...`-deep links.
- `/employers`-aktivering uendret.
- Typecheck + build grønne.
