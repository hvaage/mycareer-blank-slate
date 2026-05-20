## Rotårsak

I TanStack Start sin filbaserte ruting blir `src/routes/selskapsanalyse.takk.tsx` automatisk et **barn** av `src/routes/selskapsanalyse.tsx` (felles `selskapsanalyse.`-prefiks → nested route). Det er bekreftet i den genererte ruteringen: `SelskapsanalyseRouteWithChildren` med `SelskapsanalyseTakkRoute` som child.

Men forelder-ruten `selskapsanalyse.tsx` rendrer `SelskapsanalysePage` (selve registreringssiden) og har **ingen `<Outlet />`**. Resultat: når URL-en er `/selskapsanalyse/takk?token=...`, matcher routeren begge rutene, men barnets komponent får aldri en plass å rendre i. Brukeren ser registreringssiden uansett.

Bekreftet ved direkte HTTP-test mot publisert prod:
- `GET /selskapsanalyse/takk?token=...` → HTML inneholder `"Fornavn"` og `"Hent Claude skillen"` (registreringssiden), men IKKE `"Takk! Én rask ting"` eller `"Last ned Claude-skillen"`.
- `email_send_log`: bekreftelsesmail ble sendt OK.
- `lead_events`: tom — brukeren kunne aldri klikke noe på takk-siden.
- `/api/public/selskapsanalyse/download?token=...` returnerer korrekt 403 "Du må koble til..." — så snart connect/follow logges blir nedlasting åpnet.

Dette forklarer alle tre symptomene brukeren rapporterer:
1. Etter submit blir brukeren "ikke tatt noe sted" — `navigate({ to: "/selskapsanalyse/takk", ... })` skifter URL, men siden ser identisk ut.
2. Lenken i e-posten åpner samme URL og viser samme registreringsside.
3. Når man "trykker download-lenken" havner man på registreringssiden av samme grunn.

## Korrigering (kun frontend / ruting)

1. Gjør `src/routes/selskapsanalyse.tsx` om til et layout-skall:
   - Erstatt `component: SelskapsanalysePage` med en komponent som returnerer `<Outlet />`.
   - Behold ingen sidetspesifikk `head()` her (flyttes til index).
2. Opprett `src/routes/selskapsanalyse.index.tsx` med dagens innhold fra `selskapsanalyse.tsx`:
   - All eksisterende `head()`-metadata (title, og:*, canonical osv.).
   - `SelskapsanalysePage`-komponenten + `Check`-hjelperen + alle imports (`Header`, `Footer`, `LeadForm`, `DimensionsRadar`, `DIMENSJONER`, `STEG`, `LAND`, `SELSKAPSANALYSE`).
   - `createFileRoute("/selskapsanalyse/")` (med trailing slash → barneindex).
3. Ikke rør `selskapsanalyse.takk.tsx`, `download.ts`, `preview-email.ts`, `leads.functions.ts` eller e-postmalen — disse er korrekte.
4. Rydd opp et lite kosmetisk biprodukt: i `selskapsanalyse.takk.tsx` har `validateSearch` `test: z.string().optional().default("")`, som ved navigasjon uten `test` lager en `?token=...&test=` 307-redirect. Endre default til `undefined` (eller `.optional()` uten default) så URL-en holdes ren.

## Verifisering

Etter at brukeren publiserer på nytt:
- `curl -L 'https://karrierenmin.no/selskapsanalyse/takk?token=<token>'` skal returnere HTML som inneholder `"Takk! Én rask ting"` og LinkedIn-knappene.
- `/selskapsanalyse` skal fortsatt vise registreringssiden uendret.
- Etter submit i nettleser: brukeren skal lande på `/selskapsanalyse/takk?token=...` og se LinkedIn-gate-en.
- Etter klikk på "Koble til Henrik": `lead_events` får en `connect_click`-rad, nedlastingsknappen vises, og GET mot download-ruten returnerer .skill-filen i stedet for 403.
- E-postlenken (samme URL) leder nå direkte til takk-siden med LinkedIn-gate (eller direkte til nedlasting hvis connect/follow allerede er klikket).

## Filer som endres

- `src/routes/selskapsanalyse.tsx` — gjøres om til layout-skall med `<Outlet />`.
- `src/routes/selskapsanalyse.index.tsx` — ny fil med dagens landing-page-innhold.
- `src/routes/selskapsanalyse.takk.tsx` — én linje: fjern `.default("")` på `test` i `validateSearch`.
