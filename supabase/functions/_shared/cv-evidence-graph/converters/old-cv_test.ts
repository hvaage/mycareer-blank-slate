// Tests for convertOldCv heuristics (C.1–C.4)
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { convertOldCv, type ParsedOldCv } from "./old-cv.ts";

const ctx = {
  user_id: "00000000-0000-0000-0000-000000000001",
  import_id: "00000000-0000-0000-0000-000000000002",
  source_format: "pdf" as const,
};

function baseExp(over: Record<string, unknown> = {}) {
  return {
    company: "Acme",
    title: "Senior Developer",
    start: "2010-01",
    end: "2015-01",
    is_current: false,
    description: null,
    bullets: [],
    ...over,
  };
}

Deno.test("C.3 — bullet 'Merged with X' flyttes til employer_description", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({
        company: "MBS Fjernata",
        bullets: [
          "Merged with Merkantildata in 1997.",
          "Led migration of legacy banking system.",
        ],
      }),
    ],
  } as ParsedOldCv;

  const r = convertOldCv(parsed, ctx);
  assertEquals(r.role_trees.length, 1);
  const tree = r.role_trees[0];
  // Kun 1 ekte achievement
  assertEquals(tree.achievements.length, 1);
  assertEquals((tree.achievements[0].structured_data as any).what, "Led migration of legacy banking system.");
  // Selskaps-noten endte i employer_description
  const sd = tree.role.structured_data as any;
  assertEquals(sd.employer_description, "Merged with Merkantildata in 1997.");
  // Skipped-log inneholder forklaring
  assert(r.skipped.some((s) => s.reason.includes("selskaps-kontekst")));
});

Deno.test("C.3 — personlig handling beholdes selv om den nevner oppkjøp", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({
        bullets: ["Led integration after acquisition by Google in 2018."],
      }),
    ],
  } as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(r.role_trees[0].achievements.length, 1);
});

Deno.test("C.1 — employer_note fra parser mappes til employer_description", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({ employer_note: "Subsidiary of Telenor", bullets: ["Built X"] }),
    ],
  } as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  const sd = r.role_trees[0].role.structured_data as any;
  assertEquals(sd.employer_description, "Subsidiary of Telenor");
});

Deno.test("C.2 — content_no faller tilbake hvis description duplikerer en bullet", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({
        description: "Merged with Merkantildata in 1997",
        bullets: ["Merged with Merkantildata in 1997."],
      }),
    ],
  } as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  const role = r.role_trees[0].role;
  // Bulleten ble dessuten filtrert som selskaps-kontekst → ingen achievement
  assertEquals(r.role_trees[0].achievements.length, 0);
  // content_no faller til fallback fordi description matcher den (filtrerte) bulleten,
  // og description er også selskaps-kontekst — men her sjekker vi bare at den ikke er en selskaps-noten-kopi
  assertEquals(role.content_no, "Senior Developer hos Acme");
});

Deno.test("C.2 — role_summary brukes når den ikke duplikerer bullets", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({
        role_summary: "Ledet et team på 8 utviklere i fintech-domenet.",
        bullets: ["Lanserte ny betalingsplattform"],
      }),
    ],
  } as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(
    r.role_trees[0].role.content_no,
    "Ledet et team på 8 utviklere i fintech-domenet.",
  );
});

Deno.test("C.4 — experience-rad uten bullets og selskaps-tittel droppes", () => {
  const parsed: ParsedOldCv = {
    experience: [
      baseExp({ company: "Acme", title: "Merged with Foo in 1999", bullets: [] }),
    ],
  } as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(r.role_trees.length, 0);
  assert(r.skipped.some((s) => s.reason.includes("selskapshendelse")));
});
