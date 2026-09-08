# Rollback-/oppryddingsnotat — OAuth 2.1, claim-rate og capability-challenges

Gjelder migrasjonen som oppretter `oauth_clients`, `oauth_grants`,
`oauth_authorization_codes`, `oauth_refresh_tokens`,
`oauth_access_token_revocations`, `claim_rate_events` og
`capability_challenges`.

Det finnes **ingen automatisk destruktiv rollback**. Tabellene kan inneholde
aktive tillatelser (`oauth_grants`) som brukere har gitt; å slippe dem ville
koblet fra assistenter uten varsel.

## Hvis migrasjonen må reverseres manuelt

1. Bekreft at ingen OAuth-ruter eller MCP-endepunkt er i drift.
2. Bekreft at tabellene er tomme:
   `select count(*) from public.oauth_grants;` (og tilsvarende for de andre).
   Er de ikke tomme: stopp og avklar med prosjekteier først.
3. Kjør i én transaksjon, uten `CASCADE`, i denne rekkefølgen (avhengigheter
   først):

```sql
BEGIN;
DROP TABLE public.oauth_access_token_revocations;
DROP TABLE public.oauth_refresh_tokens;
DROP TABLE public.oauth_authorization_codes;
DROP TABLE public.capability_challenges;
DROP TABLE public.claim_rate_events;
DROP TABLE public.oauth_grants;
DROP TABLE public.oauth_clients;
COMMIT;
```

4. Fjern `CLAIM_RATE_HASH_SECRET` først når claim-ruten ikke lenger krever
   den — ruten feiler lukket uten hemmeligheten.

## Løpende opprydding (ikke rollback)

- `claim_rate_events`: rader eldre enn 24 timer ryddes opportunistisk av
  `claimRateCheck`. En periodisk `delete from public.claim_rate_events where
  occurred_at < now() - interval '24 hours';` kan legges til ved behov.
- `oauth_authorization_codes`: levetid er 60 sekunder; rader eldre enn en
  time kan slettes trygt.
- `oauth_refresh_tokens` og `oauth_access_token_revocations`: rader kan
  slettes når `expires_at` er passert. Behold gjenbruksdeteksjon
  (`reuse_detected_at`) så lenge den har verdi for sikkerhetsoppfølging.
- `capability_challenges`: `pending`-rader forbi `expires_at` settes til
  `expired`, ikke slettes umiddelbart.

## Sikkerhetsforutsetninger

- Alle tabellene har RLS på og **ingen** policy, og ingen `GRANT` til `anon`
  eller `authenticated`. Det er tilsiktet: dette er rene serverobjekter.
  Security Advisor vil derfor rapportere INFO `0008 rls_enabled_no_policy`
  for hver av dem.
- Ingen `SECURITY DEFINER`-funksjoner ble innført.
- Serverrutene må bruke den server-side admin-klienten
  (`@/integrations/supabase/client.server`), aldri klientnøkkel.
