// Kanonisk kontrakt for generell CV-generering (fase 4B).
//
// Rene funksjoner: ingen database, ingen nettverk, ingen env.
//   - frosset atom-snapshot og hashing
//   - promptbygging (kun snapshot + preferanser — aldri rå importtekst)
//   - parsing og streng validering av modellsvaret
//   - server-genererte blockId/claimId/outputHash/snapshotHash
//   - rendering til leselig CV-tekst og til leverandørens CvDraft
//
// Kontaktfelt genereres ALDRI av modellen. De settes fra profildata.

import type { CareerAtomRow } from "../adapters/career-atom-adapter.ts";
import type { CvDraft } from "../vendor/cv-ats-rules-no/scripts/types.ts";

export const GENERATION_OUTPUT_CONTRACT_VERSION = "1.0.0";

export type SnapshotAtom = {
  id: string;
  atom_kind: string;
  atom_class: string | null;
  atom_type: string | null;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: unknown;
  source_quote: string | null;
  confidence: string | null;
};

export type GenerationSnapshot = {
  atoms: SnapshotAtom[];
  preferences: Record<string, unknown>;
  frozen_at: string;
  contract_version: string;
};

export type ContactHeader = {
  full_name: string;
  headline: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
};

export type GeneratedBlock = {
  blockId: string;
  section: string;
  ordinal: number;
  text: string;
  supportingAtomIds: string[];
  requirementAtomIds: string[];
  claimIds: string[];
  sourceSnapshotHash: string;
};

export type GeneratedClaim = {
  claimId: string;
  blockId: string;
  type: "hard" | "soft";
  value: string;
  supportingAtomIds: string[];
  verification: "supported" | "partially_supported" | "unsupported" | "not_applicable";
};

export type GeneratedDocument = {
  blocks: GeneratedBlock[];
  claims: GeneratedClaim[];
};

const ALLOWED_SECTIONS = [
  "summary",
  "experience",
  "education",
  "skills",
  "certifications",
  "languages",
] as const;

// ---------------------------------------------------------------- hashing

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stabil serialisering: nøkkelrekkefølge påvirker aldri hashen. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// --------------------------------------------------------------- snapshot

export function buildSnapshot(
  rows: CareerAtomRow[],
  preferences: Record<string, unknown>,
  frozenAt: string,
): GenerationSnapshot {
  const atoms: SnapshotAtom[] = rows
    .map((r) => ({
      id: r.id,
      atom_kind: r.atom_kind,
      atom_class: r.atom_class,
      atom_type: r.atom_type,
      parent_atom_id: r.parent_atom_id,
      content_no: r.content_no,
      content_en: r.content_en,
      structured_data: r.structured_data ?? null,
      source_quote: r.source_quote,
      confidence: r.confidence,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    atoms,
    preferences,
    frozen_at: frozenAt,
    contract_version: GENERATION_OUTPUT_CONTRACT_VERSION,
  };
}

export function snapshotHashInput(snapshot: GenerationSnapshot): string {
  return stableStringify({ atoms: snapshot.atoms, preferences: snapshot.preferences });
}

// ----------------------------------------------------------------- prompt

export const GENERATION_SYSTEM_PROMPT_NO = `Du skriver en generell norsk CV utelukkende fra et frosset, brukerbekreftet faktagrunnlag.

Ufravikelige regler:
1. Hver setning du skriver må kunne spores til minst ett atom i grunnlaget. Oppgi atom-ID-ene.
2. Du kan ALDRI innføre tall, prosenter, beløp, årstall, datoer, selskapsnavn, titler, steder eller sertifikater som ikke står i grunnlaget.
3. Du kan ikke gjøre et tall mer presist, avrunde det, eller regne om.
4. Du skriver ikke kontaktinformasjon, navn, e-post, telefon eller lenker. Det settes utenfor deg.
5. Ingen superlativer uten dekning, ingen klisjeer, ingen "ansvarlig for"-formuleringer der en handling er dokumentert.
6. Aktive verb i preteritum for avsluttede roller, presens for pågående rolle.
7. Skriv norsk bokmål. Ingen engelske moteord.
8. Mangler grunnlaget noe, utelater du det. Du fyller aldri hull med antakelser.

Du svarer kun med gyldig JSON etter kontrakten under. Ingen forklaring, ingen markdown.`;

export const GENERATION_OUTPUT_CONTRACT_NO = `SVARKONTRAKT (JSON, ingen andre felt):
{
  "blocks": [
    {
      "section": "summary" | "experience" | "education" | "skills" | "certifications" | "languages",
      "text": "ferdig CV-tekst for blokken",
      "atomIds": ["<atom-id fra grunnlaget>"],
      "claims": [
        { "type": "hard" | "soft", "value": "den konkrete påstanden i teksten", "atomIds": ["<atom-id>"] }
      ]
    }
  ]
}
"hard" = tall, dato, beløp, prosent, selskap, tittel, sertifikat.
"soft" = handling eller egenskap uten eksakt verdi.
Alle atomIds MÅ finnes i grunnlaget. Ukjent ID gjør hele svaret ugyldig.`;

export function buildGenerationUserPrompt(input: {
  snapshot: GenerationSnapshot;
  snapshotHash: string;
  presentation: Record<string, unknown>;
}): string {
  const atoms = input.snapshot.atoms.map((a) => ({
    id: a.id,
    klasse: a.atom_class,
    type: a.atom_type,
    forelder: a.parent_atom_id,
    innhold: a.content_no ?? a.content_en,
    data: a.structured_data ?? null,
  }));
  return [
    `Grunnlagshash: ${input.snapshotHash}`,
    `Presentasjonsvalg: ${JSON.stringify(input.presentation)}`,
    input.snapshot.preferences && Object.keys(input.snapshot.preferences).length > 0
      ? `Brukerpreferanser: ${JSON.stringify(input.snapshot.preferences)}`
      : "Brukerpreferanser: ingen aktive",
    "",
    "FAKTAGRUNNLAG (frosset, brukerbekreftet):",
    JSON.stringify(atoms, null, 1),
    "",
    GENERATION_OUTPUT_CONTRACT_NO,
  ].join("\n");
}

// ----------------------------------------------------------------- parsing

type RawBlock = {
  section?: unknown;
  text?: unknown;
  atomIds?: unknown;
  claims?: unknown;
};

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ParseResult =
  | { ok: true; document: GeneratedDocument }
  | { ok: false; errors: string[] };

/**
 * Parser og validerer modellsvaret mot det frosne kandidatsettet.
 * Server eier blockId, claimId og sourceSnapshotHash — modellen får aldri sette dem.
 */
export function parseGenerationOutput(
  rawText: string | null,
  allowedAtomIds: Set<string>,
  snapshotHash: string,
): ParseResult {
  const errors: string[] = [];
  const parsed = extractJson(rawText ?? "");
  if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["invalid_json"] };
  const rawBlocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    return { ok: false, errors: ["missing_blocks"] };
  }

  const blocks: GeneratedBlock[] = [];
  const claims: GeneratedClaim[] = [];
  let blockNo = 0;
  let claimNo = 0;

  for (const item of rawBlocks as RawBlock[]) {
    const section = typeof item.section === "string" ? item.section : "";
    if (!(ALLOWED_SECTIONS as readonly string[]).includes(section)) {
      errors.push(`unknown_section:${section.slice(0, 24)}`);
      continue;
    }
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) {
      errors.push(`empty_text:${section}`);
      continue;
    }
    const atomIds = Array.isArray(item.atomIds)
      ? item.atomIds.filter((x): x is string => typeof x === "string")
      : [];
    const unknownAtoms = atomIds.filter((id) => !allowedAtomIds.has(id));
    if (unknownAtoms.length > 0) {
      errors.push(`unknown_atom_id:${unknownAtoms.length}`);
      continue;
    }
    if (atomIds.length === 0) {
      errors.push(`block_without_evidence:${section}`);
      continue;
    }

    blockNo += 1;
    const blockId = `b${blockNo}`;
    const claimIds: string[] = [];

    const rawClaims = Array.isArray(item.claims) ? item.claims : [];
    for (const c of rawClaims as Record<string, unknown>[]) {
      const type = c["type"] === "hard" ? "hard" : c["type"] === "soft" ? "soft" : null;
      const value = typeof c["value"] === "string" ? c["value"].trim() : "";
      if (!type || !value) {
        errors.push(`invalid_claim:${blockId}`);
        continue;
      }
      const cAtoms = Array.isArray(c["atomIds"])
        ? (c["atomIds"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const unknownClaimAtoms = cAtoms.filter((id) => !allowedAtomIds.has(id));
      if (unknownClaimAtoms.length > 0) {
        errors.push(`unknown_atom_id:${unknownClaimAtoms.length}`);
        continue;
      }
      claimNo += 1;
      const claimId = `c${claimNo}`;
      claimIds.push(claimId);
      claims.push({
        claimId,
        blockId,
        type,
        value,
        supportingAtomIds: cAtoms.length > 0 ? cAtoms : atomIds,
        verification: "unsupported",
      });
    }

    blocks.push({
      blockId,
      section,
      ordinal: blockNo,
      text,
      supportingAtomIds: atomIds,
      requirementAtomIds: [],
      claimIds,
      sourceSnapshotHash: snapshotHash,
    });
  }

  if (blocks.length === 0) {
    return { ok: false, errors: errors.length > 0 ? errors : ["no_valid_blocks"] };
  }
  // Ukjent atom-ID hvor som helst i svaret er en valideringsblokkering.
  if (errors.some((e) => e.startsWith("unknown_atom_id"))) {
    return { ok: false, errors };
  }
  return { ok: true, document: { blocks, claims } };
}

// --------------------------------------------------------------- rendering

const SECTION_TITLES: Record<string, string> = {
  summary: "Sammendrag",
  experience: "Erfaring",
  education: "Utdanning",
  skills: "Kompetanse",
  certifications: "Sertifiseringer",
  languages: "Språk",
};

/** Leselig CV-tekst. Kontaktlinjen kommer fra profildata, ikke fra modellen. */
export function renderDocumentText(blocks: GeneratedBlock[], contact: ContactHeader): string {
  const head = [
    contact.full_name,
    contact.headline ?? "",
    [contact.city, contact.country].filter(Boolean).join(", "),
    [contact.email, contact.phone, contact.linkedin_url].filter(Boolean).join(" | "),
  ]
    .filter((l) => l && l.trim().length > 0)
    .join("\n");

  const bySection = new Map<string, GeneratedBlock[]>();
  for (const b of [...blocks].sort((a, b) => a.ordinal - b.ordinal)) {
    const list = bySection.get(b.section) ?? [];
    list.push(b);
    bySection.set(b.section, list);
  }
  const body = [...bySection.entries()]
    .map(([section, list]) =>
      [SECTION_TITLES[section] ?? section, ...list.map((b) => b.text)].join("\n"),
    )
    .join("\n\n");

  return `${head}\n\n${body}\n`;
}

/** Bygger leverandørens CvDraft for ATS-kontroll. Kun teknisk struktur i fase 4B. */
export function buildAtsDraft(blocks: GeneratedBlock[], contact: ContactHeader): CvDraft {
  const inSection = (s: string) => blocks.filter((b) => b.section === s);
  const summary = inSection("summary")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return {
    language: "no",
    header: {
      full_name: contact.full_name,
      headline: contact.headline,
      city: contact.city,
      country: contact.country,
      phone: contact.phone,
      email: contact.email,
      linkedin_url: contact.linkedin_url,
      website_url: null,
      birth_year: null,
      nationality: null,
      has_profile_photo: false,
    },
    summary: summary.length > 0 ? summary : null,
    roles: inSection("experience").map((b) => ({
      title: firstLine(b.text),
      employer: "",
      location: null,
      start_date: "",
      end_date: null,
      is_current: false,
      description: b.text,
      achievements: [],
      atom_ids: b.supportingAtomIds,
    })),
    educations: [],
    skills: inSection("skills").map((b) => ({
      name: firstLine(b.text),
      category: "generell",
      proficiency: null,
    })),
    languages: [],
    certifications: [],
    projects: [],
    volunteer: [],
  } as CvDraft;
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? text).slice(0, 120).trim();
}

/** Kvalitetsinput bygget av blokkene. Sammendrag og erfaring vurderes separat. */
export function buildQualityInput(blocks: GeneratedBlock[]): {
  language: "no";
  summary?: string;
  roles: { is_current: boolean; description: string | null; achievements: string[] }[];
} {
  const summary = blocks
    .filter((b) => b.section === "summary")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return {
    language: "no",
    ...(summary ? { summary } : {}),
    roles: blocks
      .filter((b) => b.section === "experience")
      .map((b) => ({ is_current: false, description: b.text, achievements: [] })),
  };
}
