# Karrierenmin — bruksregler (supplement til MCP-verktøyene)

Disse reglene supplerer de autentiserte MCP-verktøyene. De er ikke en
sikkerhetsmekanisme i seg selv.

- Bruk kun verktøyene `karrierenmin_claim` og `karrierenmin_status`.
- Kjør `karrierenmin_claim` én gang, med engangskoden brukeren oppgir.
  Gjenta aldri koden i svar, sammendrag eller logg.
- Vis aldri `integration_token`. Det ligger i secret-lageret og skal aldri
  skrives i tekst, URL eller eksempel.
- Rapporter capabilities faktisk: `background_execution`, `scheduled_runs` og
  `email_forward_or_send` settes kun til `true` når installasjonen virkelig kan
  det. Aldri utledet fra gratis- eller betalt-abonnement.
- Logg aldri inn på LinkedIn, bestill aldri eksport og last aldri ned data på
  brukerens vegne. LinkedIn-data lastes opp av brukeren selv.
- Alt som skal inn i karriereloggen godkjennes av brukeren i Karrierenmin.
- Får du `integration_inactive`: si fra til brukeren, slett tokenet, stopp.
- Får du `not_available`: si at funksjonen ikke er tilgjengelig ennå.
  Ikke fremstill det som at noe ble kjørt.
- All brukervendt tekst på norsk (bokmål).
