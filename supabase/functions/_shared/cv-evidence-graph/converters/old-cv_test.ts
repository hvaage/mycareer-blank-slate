// Tester for convertOldCv (v4 parselag: flat kandidatliste med local_ref-tre)
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { convertOldCv, type ParsedOldCv } from "./old-cv.ts";
import type { CandidateDraft } from "../types.ts";

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

const roles = (cs: CandidateDraft[]) => cs.filter((c) => c.suggested_atom_type === "role");
const childrenOf = (cs: CandidateDraft[], ref: string) =>
  cs.filter((c) => c.parent_local_ref === ref);
const sd = (c: CandidateDraft) => c.structured_data as Record<string, unknown>;

Deno.test("C.3 — bullet 'Merged with X' flyttes til employer_description", () => {
  const parsed = {
    experience: [
      baseExp({
        company: "MBS Fjernata",
        bullets: [
          "Merged with Merkantildata in 1997.",
          "Led migration of legacy banking system.",
        ],
      }),
    ],
  } as unknown as ParsedOldCv;

  const r = convertOldCv(parsed, ctx);
  const rs = roles(r.candidates);
  assertEquals(rs.length, 1);
  const achs = childrenOf(r.candidates, rs[0].local_ref);
  assertEquals(achs.length, 1);
  assertEquals(sd(achs[0]).what, "Led migration of legacy banking system.");
  assertEquals(sd(rs[0]).employer_description, "Merged with Merkantildata in 1997.");
  assert(r.skipped.some((s) => s.reason.includes("selskaps-kontekst")));
});

Deno.test("C.3 — personlig handling beholdes selv om den nevner oppkjøp", () => {
  const parsed = {
    experience: [baseExp({ bullets: ["Led integration after acquisition by Google in 2018."] })],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(childrenOf(r.candidates, roles(r.candidates)[0].local_ref).length, 1);
});

Deno.test("C.1 — employer_note fra parser mappes til employer_description", () => {
  const parsed = {
    experience: [baseExp({ employer_note: "Subsidiary of Telenor", bullets: ["Built X"] })],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(sd(roles(r.candidates)[0]).employer_description, "Subsidiary of Telenor");
});

Deno.test("C.2 — content_no faller tilbake hvis description duplikerer en bullet", () => {
  const parsed = {
    experience: [
      baseExp({
        description: "Merged with Merkantildata in 1997",
        bullets: ["Merged with Merkantildata in 1997."],
      }),
    ],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  const role = roles(r.candidates)[0];
  assertEquals(childrenOf(r.candidates, role.local_ref).length, 0);
  assertEquals(role.content_no, "Senior Developer hos Acme");
});

Deno.test("C.2 — role_summary brukes når den ikke duplikerer bullets", () => {
  const parsed = {
    experience: [
      baseExp({
        role_summary: "Ledet et team på 8 utviklere i fintech-domenet.",
        bullets: ["Lanserte ny betalingsplattform"],
      }),
    ],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(roles(r.candidates)[0].content_no, "Ledet et team på 8 utviklere i fintech-domenet.");
});

Deno.test("C.4 — experience-rad uten bullets og selskaps-tittel droppes", () => {
  const parsed = {
    experience: [baseExp({ company: "Acme", title: "Merged with Foo in 1999", bullets: [] })],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  assertEquals(roles(r.candidates).length, 0);
  assert(r.skipped.some((s) => s.reason.includes("selskapshendelse")));
});

Deno.test("treet bevares: hvert achievement peker på riktig rolle", () => {
  const parsed = {
    experience: [
      baseExp({ company: "Alfa AS", title: "Salgssjef", bullets: ["Økte ARR til 30 MNOK"] }),
      baseExp({ company: "Beta AS", title: "Account Executive", bullets: ["Landet stor kontrakt"] }),
    ],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  const byRef = new Map(r.candidates.map((c) => [c.local_ref, c]));
  const achs = r.candidates.filter((c) => c.suggested_atom_type === "achievement");
  assertEquals(achs.length, 2);
  for (const a of achs) {
    assert(a.parent_local_ref, "achievement må ha forelder");
    const parent = byRef.get(a.parent_local_ref!);
    assert(parent, "forelder må finnes i samme import");
    assertEquals(parent!.suggested_atom_type, "role");
  }
  assertEquals(sd(byRef.get(achs[0].parent_local_ref!)!).employer, "Alfa AS");
  assertEquals(sd(byRef.get(achs[1].parent_local_ref!)!).employer, "Beta AS");
});

Deno.test("navneleksikon gir forhåndsvalg for kjente navn, resten blir spørsmål", () => {
  const parsed = {
    skills: ["Salesforce", "Excel", "Engelsk", "MEDDPICC"],
  } as unknown as ParsedOldCv;
  const r = convertOldCv(parsed, ctx);
  const byName = new Map(r.candidates.map((c) => [c.content_no, c]));
  assertEquals(byName.get("Salesforce")!.suggested_atom_type, "tool");
  assertEquals(byName.get("Excel")!.suggested_atom_type, "tool");
  assertEquals(byName.get("Engelsk")!.suggested_atom_type, "language");
  // Ukjent navn: fortsatt kompetanse-kandidat med ukjent kategori = spørsmål.
  assertEquals(byName.get("MEDDPICC")!.suggested_atom_type, "skill");
  assertEquals(byName.get("MEDDPICC")!.suggested_from_category, "other");
});
