# Sikkerhetsregler som gjelder alle fire pakkene

1. **Tokenet er en hemmelighet.** Lagre `integration_token` i plattformens sikre
   secret-/credential-lager når plattformen har et. Har den ikke det, si det
   rett ut i pakkens README og la brukeren selv velge lagring.
2. **Aldri i prompt, logg, URL eller eksempel.** Token og engangskode skal aldri
   skrives i systemprompt, samtalelogg, feilmelding, README-eksempel eller
   query-parameter. Send alltid tokenet i `Authorization: Bearer`.
3. **Engangskoden brukes én gang.** Ikke lagre den etter claim. Ikke prøv å
   gjenbruke den. Feiler claim: be brukeren lage en ny kode i Karrierenmin.
4. **Capabilities rapporteres faktisk.** Rapporter kun det installasjonen
   virkelig kan. Aldri utledet fra abonnementstype eller markedsføring.
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
