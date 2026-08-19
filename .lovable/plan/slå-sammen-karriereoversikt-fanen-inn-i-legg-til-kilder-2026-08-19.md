# Slå sammen «Karriereoversikt»-fanen inn i «Legg til kilder»

## Hva som er bekreftet i dag

Begge stedene rendrer nøyaktig samme komponent (`AboutMeCvSection`):

- `/min-profil` («Om meg») har en fane «Karriereoversikt» som viser den.
- `/kilder` («Legg til kilder» → «Ditt eget grunnlag» → «Eksisterende CV») viser den samme.

Derfor er innholdet ikke bare likt — det er det samme. Ett sted er nok.

## Slik blir det

- «Om meg» (`/min-profil`) blir én ren side uten faner: bare profilspørsmålene
  (Kort om deg, Bakgrunn, Ønsket jobb, Geografi, Utdypning). Fanevelgeren
  «Om meg / Karriereoversikt» forsvinner.
- CV-opplasting, status («63 elementer i karriereoversikten») og «Tidligere
  opplastinger» finnes bare under **Legg til kilder → Ditt eget grunnlag →
  Eksisterende CV**, akkurat som i dag.
- Gamle adresser fortsetter å virke: `/min-profil?tab=karriereoversikt` (og
  `?tab=cv`, samt `/about-me?tab=...`) sender brukeren videre til `/kilder`.
- Alle interne knapper og lenker som i dag sier «Om meg → Karriereoversikt»
  eller «Last opp CV under Om meg» endres til å peke på **Legg til kilder** og
  får ny tekst («Gå til Legg til kilder», «Last opp CV under Legg til kilder»).

```text
Før                                  Etter
/min-profil                          /min-profil
  [Om meg] [Karriereoversikt]          (ingen faner — bare Om meg)
              └── CV-opplasting
/kilder                              /kilder
  Ditt eget grunnlag                   Ditt eget grunnlag
    Eksisterende CV → CV-opplasting      Eksisterende CV → CV-opplasting  (eneste sted)
```

## Teknisk

1. `src/components/pages/about-me-page.tsx`: fjern `Tabs`/`TabsList`/
   `TabsContent` og importen av `AboutMeCvSection`; behold seksjonsinnholdet
   direkte. Fjern `activeTab`-utledningen fra `search`.
2. `src/routes/_authenticated/min-profil/index.tsx`: legg til `beforeLoad`-
   redirect til `/kilder` når `search.tab` er `karriereoversikt` eller `cv`;
   andre `tab`-verdier ignoreres som før. `/about-me` videresender allerede til
   `/min-profil` med bevart søk, så den arver samme oppførsel.
3. Oppdater lenker/tekst i:
   - `src/components/career/experience-overview.tsx` (2 steder)
   - `src/components/pages/cv-review-page.tsx` (tekst + 2 lenker)
   - `src/routes/_authenticated/documentation/kompetanse.tsx`
   - `src/routes/_authenticated/documentation/resultater.tsx`
   - `src/components/career/PreferencesAtomsSection.tsx`
   - `src/routes/_authenticated/min-profil/karriereretning.tsx` (2 steder,
     «Last opp CV»-lenkene → `/kilder`; rene «Om meg»-lenker beholdes)
   - `src/routes/_authenticated/job-leads.tsx` (kun hvis lenken gjelder CV-opplasting)
4. Ingen backend-, skjema- eller datamodellendringer. `AboutMeCvSection`
   beholdes uendret og brukes bare fra `/kilder`.
