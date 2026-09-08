# Karrierenmin — bruksregler (designmal)

Status: designmal. Det finnes ingen fungerende MCP-server eller plugin ennå.
Reglene er bruksregler, ikke en sikkerhetsmekanisme, og skal aldri være eneste
kontroll.

- Bruk kun `karrierenmin_claim` og `karrierenmin_status`.
- Claim er uten token og utsteder tokenet. Sett aldri Authorization på claim.
  Planlagt varig autentisering er OAuth 2.1 med PKCE, ikke et bearer-token du
  forventes å lagre selv.
- Kjør `karrierenmin_claim` én gang, med engangskoden brukeren oppgir. Gjenta
  aldri koden i svar, sammendrag eller logg.
- Tokenet lagres ikke automatisk noe sted. Vis aldri `integration_token`. Det skal aldri skrives i tekst, URL eller
  eksempel.
- Send ikke capabilities i claim. Serveren ignorerer dem, og ingen egenskap blir
  bekreftet av en klientpåstand. `background_execution`, `scheduled_runs` og
  `email_forward_or_send` står som ubekreftet til serveren har verifisert dem
  faktisk. Aldri utledet fra gratis- eller betalt-abonnement.
- Feiler noe etter at koden er brukt: koden er oppbrukt. Be brukeren lage en ny
  kode i Karrierenmin. Ikke gjett eller forklar intern årsak.
- Logg aldri inn på LinkedIn, bestill aldri eksport og last aldri ned data på
  brukerens vegne. LinkedIn-data lastes opp av brukeren selv.
- Alt som skal inn i karriereloggen godkjennes av brukeren i Karrierenmin.
- `integration_inactive`: si fra, slett tokenet, stopp.
- `not_available`: funksjonen finnes ikke ennå. Ikke fremstill det som kjørt.
- All brukervendt tekst på norsk (bokmål).
