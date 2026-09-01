import {
  retryBackoffMinutes,
  unsupportedRegnskapApiReason,
} from "./db.ts";
import { isDeferredUpstreamRetry } from "./runner.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("standard retry backoff remains capped at two hours", () => {
  assert(retryBackoffMinutes(null, 0) === 5, "first network retry is 5 min");
  assert(retryBackoffMinutes(503, 1) === 10, "second 503 retry is 10 min");
  assert(retryBackoffMinutes(429, 5) === 120, "429 retry caps at 120 min");
  assert(retryBackoffMinutes(504, 50) === 120, "504 retry caps at 120 min");
});

Deno.test("BRREG 500 uses long queue backoff", () => {
  assert(retryBackoffMinutes(500, 0) === 360, "first 500 waits 6 hours");
  assert(retryBackoffMinutes(500, 1) === 1440, "second 500 waits 24 hours");
  assert(
    retryBackoffMinutes(500, 2) === 10080,
    "third 500 waits 7 days",
  );
  assert(
    retryBackoffMinutes(500, 20) === 10080,
    "500 backoff stays capped at 7 days",
  );
});

Deno.test("known unsupported regnskap API types are classified explicitly", () => {
  assert(
    unsupportedRegnskapApiReason({
      organisasjonsformKode: "SPA",
      organisasjonsformBeskrivelse: "Sparebank",
      naeringskode1Kode: "64.190",
      naeringskode1Beskrivelse: "Banker og kredittforetak",
    })?.includes("unsupported_by_brreg_open_regnskap_api"),
    "sparebank should be unsupported",
  );
  assert(
    unsupportedRegnskapApiReason({
      organisasjonsformKode: "GFS",
      organisasjonsformBeskrivelse: "Gjensidig forsikringsselskap",
      naeringskode1Kode: "65.120",
      naeringskode1Beskrivelse: "Skadeforsikring",
    })?.includes("insurance company"),
    "mutual insurance should be unsupported",
  );
  assert(
    unsupportedRegnskapApiReason({
      organisasjonsformKode: "PK",
      organisasjonsformBeskrivelse: "Pensjonskasse",
      naeringskode1Kode: "65.300",
      naeringskode1Beskrivelse: "Pensjonskasser",
    })?.includes("pension fund"),
    "pension fund should be unsupported",
  );
});

Deno.test("ordinary organisation forms are not preclassified unsupported", () => {
  assert(
    unsupportedRegnskapApiReason({
      organisasjonsformKode: "AS",
      organisasjonsformBeskrivelse: "Aksjeselskap",
      naeringskode1Kode: "62.010",
      naeringskode1Beskrivelse: "Programmeringstjenester",
    }) === null,
    "ordinary AS outside banking/insurance should not be unsupported",
  );
  assert(
    unsupportedRegnskapApiReason({
      organisasjonsformKode: "FLI",
      organisasjonsformBeskrivelse: "Forening/lag/innretning",
      naeringskode1Kode: "88.996",
      naeringskode1Beskrivelse: "Andre sosialtjenester uten botilbud ellers",
    }) === null,
    "association 500s need further upstream diagnosis, not blanket exclusion",
  );
});

Deno.test("only persisted upstream 5xx retries are deferred from batch failure", () => {
  assert(
    isDeferredUpstreamRetry("retry", 500),
    "500 retry should be a deferred upstream outcome",
  );
  assert(
    isDeferredUpstreamRetry("retry", 503),
    "503 retry should be a deferred upstream outcome",
  );
  assert(
    !isDeferredUpstreamRetry("retry", 429),
    "rate limiting remains a partial batch failure",
  );
  assert(
    !isDeferredUpstreamRetry("client_error", 400),
    "client errors are never deferred upstream outcomes",
  );
});
