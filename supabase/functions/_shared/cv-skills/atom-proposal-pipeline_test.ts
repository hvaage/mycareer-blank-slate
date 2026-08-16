// Tester for normaliseringspipelinen: stabil sortering, deterministisk
// kildehash, og at forslag uten sporbar evidens forkastes.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSegments,
  computeInputSignature,
  computeSegmentHashes,
  computeSourceHash,
  validateAndDedupe,
  type CandidateInput,
} from "./atom-proposal-pipeline.ts";

function candidate(id: string, text: string, localRef: string): CandidateInput {
  return {
    id,
    local_ref: localRef,
    suggested_atom_type: "achievement",
    content_no: text,
    content_en: null,
    source_quote: text,
    structured_data: {},
    status: "forslag",
    promoted_atom_id: null,
  } as CandidateInput;
}

const a = candidate("11111111-1111-4111-8111-111111111111", "Ledet migrering av datavarehus", "r1.a1");
const b = candidate("22222222-2222-4222-8222-222222222222", "Kuttet kostnader med 12 prosent", "r1.a2");

Deno.test("segmentrekkefølgen er stabil uansett radrekkefølge", () => {
  const one = buildSegments([a, b]).map((s) => s.id);
  const two = buildSegments([b, a]).map((s) => s.id);
  assertEquals(one, two);
});

Deno.test("batchsignaturen er deterministisk og endres med innhold", async () => {
  const importId = "33333333-3333-4333-8333-333333333333";
  const h1 = await computeInputSignature(importId, buildSegments([a, b]), "1.0.0", "1.0.0");
  const h2 = await computeInputSignature(importId, buildSegments([b, a]), "1.0.0", "1.0.0");
  assertEquals(h1, h2);

  const changed = { ...b, content_no: "Kuttet kostnader med 15 prosent" };
  const h3 = await computeInputSignature(importId, buildSegments([a, changed]), "1.0.0", "1.0.0");
  assertNotEquals(h1, h3);

  const otherVersion = await computeInputSignature(
    importId,
    buildSegments([a, b]),
    "1.0.0",
    "2.0.0",
  );
  assertNotEquals(h1, otherVersion);
});

Deno.test("source_hash representerer kun kanonisk kildeinnhold", async () => {
  // Samme tekst i to ulike kandidater gir samme innholdshash ...
  const twin = candidate("55555555-5555-4555-8555-555555555555", a.content_no!, "r2.a1");
  const hashes = await computeSegmentHashes(buildSegments([a, twin]));
  assertEquals(hashes.get(a.id), hashes.get(twin.id));

  // ... men hashen er uavhengig av import, prompt og versjon.
  const direct = await computeSourceHash("  Ledet   migrering av datavarehus \n");
  assertEquals(direct, hashes.get(a.id));
});

Deno.test("forslag med ukjent segment_id forkastes", () => {
  const segments = buildSegments([a]);
  const batch = {
    source_type: "cv_parse_candidates",
    source_id: "33333333-3333-4333-8333-333333333333",
    source_hash: "hash",
    proposals: [
      {
        proposal_id: "p1",
        atom_type: "achievement",
        content_no: "Ledet migrering av datavarehus",
        source: { segment_id: "finnes-ikke", quote: "Ledet migrering av datavarehus" },
        confidence: "high",
      },
    ],
  } as never;

  const { kept, dropped } = validateAndDedupe(batch, segments, {
    cvImportId: "33333333-3333-4333-8333-333333333333",
    segmentHashes: new Map(),
    inputSignature: "sig",
    modelRunId: "44444444-4444-4444-8444-444444444444",
    promptVersion: "1.0.0",
    normalizerVersion: "1.0.0",
  });

  assertEquals(kept.length, 0);
  assertEquals(dropped.length, 1);
});
