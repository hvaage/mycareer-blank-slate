# Sikkerhetsregler som gjelder alle fire pakkene

0. **Ingenting her er installerbart ennå.** Pakkene er design-/kildepakker.
   Det finnes ingen fungerende MCP-server og ingen plugin. Ikke beskriv dem som
   installerbare.
1. **Tokenet er en hemmelighet, og lagres manuelt.** Plattformen lagrer ikke
   automatisk et token returnert fra et verktøykall. Brukeren eller et
   installasjonsprogram må kopiere `integration_token` inn i plattformens
   secret-/credential-lager. Har plattformen ikke et, si det rett ut i pakkens
   README og la brukeren selv velge lagring.
2. **Aldri i prompt, logg, URL eller eksempel.** Token og engangskode skal aldri
   skrives i systemprompt, samtalelogg, feilmelding, README-eksempel eller
   query-parameter. Send alltid tokenet i `Authorization: Bearer`.
3. **Engangskoden brukes én gang.** Ikke lagre den etter claim. Ikke prøv å
   gjenbruke den. Feiler claim: be brukeren lage en ny kode i Karrierenmin.
4. **Capabilities bekreftes aldri av claim.** Send dem ikke; serveren ignorerer
   dem og lagrer tomme, ubekreftede egenskaper. «Forbindelsen er aktiv» er ikke
   det samme som «egenskapene er bekreftet». Rapporter aldri en egenskap som
   bekreftet før en serverkontrollert verifisering/challenge har bevist den
   faktisk. Aldri utledet fra abonnementstype eller markedsføring.
5. **Ingen automatisk LinkedIn-innlogging, bestilling eller nedlasting.**
   LinkedIn-data kommer kun fra brukerens egen offisielle ZIP-eksport, lastet
   opp av brukeren selv.
6. **Ingen egen datainnsamling.** Pakken skal ikke lese e-post, CV eller
   kontakter på egen hånd og ikke sende slikt innhold til Karrierenmin utenom
   de dokumenterte endepunktene.
7. **Alt til karriereloggen krever brukerens godkjenning** i Karrierenmin.
   Pakken kan aldri godkjenne på brukerens vegne.
8. **Frakobling gjelder umiddelbart.** Får du `integration_inactive`, slett det
   lagrede tokenet og stopp all videre kontakt.
9. **Engangskoden forbrukes før aktivering.** Feiler noe etterpå, er koden
   likevel oppbrukt. Be brukeren lage en ny kode. Ikke forklar intern årsak og
   ikke prøv koden på nytt.
10. **Claim er ikke varig autentisering.** Claim kalles uten token og utsteder
   tokenet. Ikke sett `Authorization` på hele serverforbindelsen som om claim og
   status hadde samme autentisering.
