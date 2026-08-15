/**
 * Karriereontologi v4 — oversettelse fra de deterministiske planleggerne (modul 4)
 * til `career_atoms`.
 *
 * Prinsipper som håndheves her:
 * - `atom_class` og `attestation` settes aldri fra applikasjonen. Databasen eier dem.
 * - `confidence` er en opprinnelsesakse (imported/inferred/verified), ikke en styrke.
 *   Planens numeriske `confidence_score` er forslagets egen sikkerhet og hører hjemme
 *   i beslutningsloggen — den skal aldri havne i atomet.
 * - Kompetanse (`skill`) og eksponering (`domain`) kan bare belegges indirekte.
 *   Uten pekere blir de spørsmål til brukeren, ikke atomer.
 */

import type { PlannedEvidenceAtom, PlannedPreferenceAtom } from "@/lib/career-atom-refresh";

export type CareerAtomKind =
  | "evidens"
  | "mangel"
  | "onske"
  | "maal"
  | "begrensning"
  | "verdi";

export type CareerAtomType =
  | "role"
  | "achievement"
  | "metric"
  | "context"
  | "tool"
  | "education"
  | "skill"
  | "domain"
  | "language"
  | "certification"
  | "project"
  | "volunteer"
  | "summary_fragment";

/** Klasser som kun kan belegges indirekte og derfor krever pekere. */
export const INDIRECT_ATOM_TYPES: ReadonlySet<CareerAtomType> = new Set<CareerAtomType>([
  "skill",
  "domain",
]);

/** Evidenskategoriene fra modul 4 oversatt til v4-atomtyper. */
const EVIDENCE_CATEGORY_TO_ATOM_TYPE: Record<string, CareerAtomType> = {
  technology: "skill",
  skill: "skill",
  language: "language",
  education: "education",
  certification: "certification",
  industry: "domain",
  domain: "domain",
  tool: "tool",
  leadership: "role",
  role: "role",
  commercial: "context",
  people: "context",
  network: "context",
  communication: "summary_fragment",
  result: "achievement",
  metric: "metric",
  project: "project",
  volunteer: "volunteer",
};

export function evidenceAtomTypeFor(category: string): CareerAtomType | null {
  return EVIDENCE_CATEGORY_TO_ATOM_TYPE[category.trim().toLowerCase()] ?? null;
}

export type CareerAtomFields = {
  atom_kind: CareerAtomKind;
  atom_type: CareerAtomType | null;
  parent_atom_id: string | null;
  content_no: string;
  structured_data: Record<string, unknown>;
  source_type: string;
  source_ref: string;
  source_quote: string | null;
  evidence_atom_ids: string[];
  /** Opprinnelse, ikke styrke. */
  confidence: "imported" | "inferred" | "verified";
  viktighet: number | null;
};

/** Preferanser fra profil/karriereprofil blir ønske-atomer med viktighet på 1–6-skalaen. */
export function preferencePlanToCareerAtom(pl: PlannedPreferenceAtom): CareerAtomFields {
  const label = pl.label.trim();
  const value = pl.value?.trim() || null;
  return {
    atom_kind: "onske",
    atom_type: null,
    parent_atom_id: null,
    content_no: value && value !== label ? `${label}: ${value}` : label,
    structured_data: {
      dimensjon: pl.dimension,
      etikett: label,
      verdi: value,
      logical_key: pl.logicalKey,
      source_field: pl.source_field,
      source_hash: pl.source_hash,
      career_profile_id: pl.career_profile_id,
    },
    source_type: pl.source,
    source_ref: pl.source_field,
    source_quote: value,
    evidence_atom_ids: [],
    // Regelbasert speiling av noe brukeren selv har lagt inn.
    confidence: "imported",
    viktighet: pl.importance_score,
  };
}

/**
 * Evidensplaner blir evidens-atomer. Pekere må sendes inn av kalleren; denne
 * funksjonen finner dem ikke selv.
 */
export function evidencePlanToCareerAtom(
  ev: PlannedEvidenceAtom,
  opts: { atomType: CareerAtomType; evidenceAtomIds: string[]; parentAtomId: string | null },
): CareerAtomFields {
  return {
    atom_kind: "evidens",
    atom_type: opts.atomType,
    parent_atom_id: opts.parentAtomId,
    content_no: ev.label.trim(),
    structured_data: {
      kategori: ev.category,
      beskrivelse: ev.description,
      logical_key: ev.logicalKey,
      source_field: ev.source_field,
      source_hash: ev.source_hash,
      source_document_id: ev.source_document_id,
      source_profile_field: ev.source_profile_field,
      evidence_type: ev.evidence_type,
    },
    source_type: ev.source,
    source_ref: ev.source_field,
    source_quote: ev.description,
    evidence_atom_ids: opts.evidenceAtomIds,
    confidence: "imported",
    viktighet: null,
  };
}

/** Logisk nøkkel slik den lagres på atomet, brukt til gjenkjenning ved ny kjøring. */
export function logicalKeyFromCareerAtom(structured: unknown): string | null {
  if (structured == null || typeof structured !== "object" || Array.isArray(structured)) return null;
  const v = (structured as Record<string, unknown>)["logical_key"];
  return typeof v === "string" ? v : null;
}

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Finner pekere for en foreslått kompetanse: atomer som allerede beskriver
 * kvalifikasjon, resultat eller rolle og som nevner kompetansen.
 * Ingen treff => kompetansen kan ikke belegges, og skal bli et spørsmål.
 */
export function findEvidencePointersForSkill(
  skillTerm: string,
  candidates: { id: string; atom_class: string | null; atom_type: string | null; content_no: string | null }[],
): string[] {
  const term = normText(skillTerm);
  if (term.length < 2) return [];
  const out: string[] = [];
  for (const c of candidates) {
    const belegger =
      c.atom_class === "kvalifikasjon" || c.atom_class === "resultat" || c.atom_type === "role";
    if (!belegger) continue;
    if (normText(c.content_no).includes(term)) out.push(c.id);
  }
  return out;
}

/** Trekker ut selve kompetansebegrepet fra en etikett som «Ferdighet: Python». */
export function bareTermFromLabel(label: string): string {
  const idx = label.indexOf(":");
  return (idx >= 0 ? label.slice(idx + 1) : label).trim();
}
