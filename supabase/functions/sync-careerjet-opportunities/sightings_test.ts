// Deno test for the repeated-fingerprint-sightings helper (R7).
// Required to pass: three resolver attempts with the same fingerprint yield
// `repeated_fingerprint_sightings === 2` and `distinct_valid_fingerprints === 1`.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createSightingTracker,
  noteFingerprintSighting,
  summarizeSightings,
} from "./sightings.ts";

Deno.test("repeated_fingerprint_sightings counts attempts after first sighting", () => {
  const tracker = createSightingTracker();
  const fp = "fp1:deadbeefcafebabe";

  const first = noteFingerprintSighting(tracker, fp);
  const second = noteFingerprintSighting(tracker, fp);
  const third = noteFingerprintSighting(tracker, fp);

  assertEquals(first, true, "first sighting must return true");
  assertEquals(second, false);
  assertEquals(third, false);

  const summary = summarizeSightings(tracker);
  assertEquals(summary.distinct_valid_fingerprints, 1);
  assertEquals(summary.repeated_fingerprint_sightings, 2);
});

Deno.test("mixed fingerprints: distinct counted once, repeats per duplicate attempt", () => {
  const tracker = createSightingTracker();
  noteFingerprintSighting(tracker, "fp1:a");
  noteFingerprintSighting(tracker, "fp1:b");
  noteFingerprintSighting(tracker, "fp1:a"); // repeat #1
  noteFingerprintSighting(tracker, "fp1:c");
  noteFingerprintSighting(tracker, "fp1:b"); // repeat #2
  noteFingerprintSighting(tracker, "fp1:a"); // repeat #3
  const summary = summarizeSightings(tracker);
  assertEquals(summary.distinct_valid_fingerprints, 3);
  assertEquals(summary.repeated_fingerprint_sightings, 3);
});
