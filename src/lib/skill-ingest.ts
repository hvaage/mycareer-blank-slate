// Delt nøkkel som skillen sender i Authorization/apikey-header.
// Denne ligger også i selve skill-pakken (config.json), så den er ikke
// hemmelig — den er en lavfriksjons-gate som filtrerer bort tilfeldig
// trafikk. Reell beskyttelse er Zod-validering + rate-limit + RLS.
export const SKILL_INGEST_KEY =
  "km_skill_eaa_pub_2026_5f3c91a07b8e4d2c";
