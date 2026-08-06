import { retryBackoffMinutes } from "./db.ts";

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
