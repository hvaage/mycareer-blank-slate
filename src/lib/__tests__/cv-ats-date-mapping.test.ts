// Regresjonstester for deterministisk ATS-datomapping.
// Datoer skal hentes fra structured_data i de frosne supporting-atomene,
// aldri fra generert tekst, og aldri gjøres mer presise enn grunnlaget.

import { describe, expect, it } from "vitest";
import {
  buildAtsDraft,
  buildAtsRoleDateMapping,
  parseSourceDate,
  type GeneratedBlock,
  type GenerationSnapshot,
} from "../../../supabase/functions/_shared/cv-skills/generation/contract.ts";

function block(blockId: string, ordinal: number, atomId: string): GeneratedBlock {
  return {
    blockId,
    section: "experience",
    ordinal,
    text: "Arbeidet som Country Manager. Tekst med 2019 nevnt.",
    supportingAtomIds: [atomId],
    requirementAtomIds: [],
    claimIds: [],
    sourceSnapshotHash: "hash",
  };
}

function snapshot(atoms: { id: string; structured_data: unknown }[]): GenerationSnapshot {
  return {
    atoms: atoms.map((a) => ({
      id: a.id,
      atom_kind: "evidens",
      atom_class: null,
      atom_type: "role",
      parent_atom_id: null,
      content_no: null,
      content_en: null,
      structured_data: a.structured_data,
      source_quote: null,
      confidence: "verified",
    })),
    preferences: {},
    frozen_at: "2026-08-16T00:00:00.000Z",
    contract_version: "1.0.0",
  };
}

const contact = {
  full_name: "Test Testesen",
  headline: null,
  city: null,
  country: null,
  phone: null,
  email: "test@example.com",
  linkedin_url: null,
};

describe("parseSourceDate", () => {
  it("beholder måned når grunnlaget har den", () => {
    expect(parseSourceDate("2019-04")).toEqual({ atsValue: "2019-04", precision: "month", reason: null });
  });
  it("dikter ikke opp måned for år-only", () => {
    expect(parseSourceDate("2019")).toEqual({
      atsValue: null,
      precision: "year",
      reason: "year_only_not_representable",
    });
  });
  it("behandler 1900-01 som plassholder, ikke som dato", () => {
    expect(parseSourceDate("1900-01").reason).toBe("placeholder_in_source");
  });
  it("gir eksplisitt årsak når dato mangler", () => {
    expect(parseSourceDate(null).reason).toBe("no_date_in_source");
  });
});

describe("buildAtsRoleDateMapping", () => {
  it("henter dato fra atomet, ikke fra teksten", () => {
    const s = snapshot([
      { id: "a1", structured_data: { title: "Country Manager", employer: "Symantec", start_date: "1998-04", end_date: "2006-06", is_current: false } },
    ]);
    const [m] = buildAtsRoleDateMapping([block("b1", 1, "a1")], s);
    expect(m!.startDate).toBe("1998-04");
    expect(m!.endDate).toBe("2006-06");
    expect(m!.precision).toBe("month");
    expect(m!.missingReason).toBeNull();
  });

  it("formaterer pågående rolle uten oppdiktet sluttdato", () => {
    const s = snapshot([
      { id: "a1", structured_data: { title: "CCO", employer: "Bember", start_date: "2024-08", end_date: null, is_current: true } },
    ]);
    const [m] = buildAtsRoleDateMapping([block("b1", 1, "a1")], s);
    expect(m!.isCurrent).toBe(true);
    expect(m!.endDate).toBeNull();
  });

  it("gir null med årsak når grunnlaget mangler dato", () => {
    const s = snapshot([
      { id: "a1", structured_data: { title: "CEO", employer: "Profound Putters", start_date: "1900-01", end_date: null } },
    ]);
    const [m] = buildAtsRoleDateMapping([block("b1", 1, "a1")], s);
    expect(m!.startDate).toBeNull();
    expect(m!.missingReason).toBe("placeholder_in_source");
    expect(m!.mappingError).toBeNull();
  });
});

describe("buildAtsDraft", () => {
  it("overfører alle datoer fra grunnlaget til ATS-strukturen uten mapping_error", () => {
    const s = snapshot([
      { id: "a1", structured_data: { title: "Country Manager", employer: "Symantec", start_date: "1998-04", end_date: "2006-06", is_current: false } },
      { id: "a2", structured_data: { title: "CCO", employer: "Bember", start_date: "2024-08", end_date: null, is_current: true } },
    ]);
    const { draft, dateMapping } = buildAtsDraft([block("b1", 1, "a1"), block("b2", 2, "a2")], contact, s);
    expect(draft.roles[0]!.start_date).toBe("1998-04");
    expect(draft.roles[0]!.end_date).toBe("2006-06");
    expect(draft.roles[1]!.start_date).toBe("2024-08");
    expect(draft.roles[1]!.end_date).toBeNull();
    expect(draft.roles[1]!.is_current).toBe(true);
    expect(dateMapping.filter((m) => m.mappingError !== null)).toHaveLength(0);
  });
});
