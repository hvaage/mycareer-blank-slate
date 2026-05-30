// @ts-nocheck
/**
 * Deterministic white-space / gap analysis between preference atoms, evidence atoms,
 * and optional target dimensions or job-style requirements. No AI calls.
 */

import type { EvidenceAtomCategoryId, PreferenceAtomDimensionId } from "@/lib/career-atoms";
import {
  getEvidenceAtomCategoryMeta,
  getPreferenceAtomDimensionMeta,
} from "@/lib/career-atoms";
import type { MatchDimensionId } from "@/lib/career-match-dimensions";
import { clampMatchScore, matchScoreBand } from "@/lib/career-match-dimensions";

export type AtomRef = {
  kind: "preference" | "evidence";
  id: string;
  label: string;
  dimensionOrCategory: string;
};

export type InferredRequirement = {
  id: string;
  text: string;
  relatedDimension?: MatchDimensionId;
};

export type PreferenceAlignmentRow = {
  dimension: PreferenceAtomDimensionId | string;
  preferenceCount: number;
  linkedEvidenceCount: number;
  alignmentScore1to6: number | null;
  matchedPreferences: AtomRef[];
  matchedEvidence: AtomRef[];
};

export type WhitespaceAnalysisResult = {
  matchedAreas: string[];
  weakEvidenceAreas: string[];
  missingEvidence: string[];
  /** Preferanser vs der evidens faktisk ligger (når evidens finnes, men ikke støtter preferansene). */
  preferenceStoryMismatch: string[];
  positioningOpportunities: string[];
  differentiationAngles: string[];
  preferenceAlignment: PreferenceAlignmentRow[];
  inferredRequirements: InferredRequirement[];
};

/** Heuristic: which evidence categories typically support a preference dimension. */
const PREF_TO_EVIDENCE: Partial<Record<PreferenceAtomDimensionId, EvidenceAtomCategoryId[]>> = {
  industry: ["industry", "technology", "commercial"],
  company_size: ["operations", "strategy", "commercial"],
  leadership_scope: ["leadership", "governance", "people"],
  mission: ["strategy", "communication", "result"],
  sustainability: ["governance", "strategy", "result"],
  compensation: ["finance", "commercial", "result"],
  work_style: ["operations", "communication", "people"],
  location: ["language", "network"],
  growth_stage: ["commercial", "strategy", "technology"],
  stability: ["governance", "operations", "finance"],
  learning: ["education", "certification", "project"],
  autonomy: ["leadership", "strategy", "project"],
  culture: ["people", "communication", "leadership"],
  network: ["network", "communication", "commercial"],
  role_type: ["leadership", "technology", "operations", "commercial"],
};

function avgStrength(strengths: (number | null)[]): number | null {
  const vals = strengths.filter((s): s is number => s != null && !Number.isNaN(s)).map((s) => clampMatchScore(s));
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export function identifyPreferenceAlignment(input: {
  preferenceAtoms: { id: string; dimension: string; label: string; importance_score: number | null }[];
  evidenceAtoms: { id: string; category: string; label: string; strength_score: number | null }[];
  targetDimensions?: MatchDimensionId[];
}): PreferenceAlignmentRow[] {
  const { preferenceAtoms, evidenceAtoms } = input;
  const byDim = new Map<string, typeof preferenceAtoms>();
  for (const p of preferenceAtoms) {
    const list = byDim.get(p.dimension) ?? [];
    list.push(p);
    byDim.set(p.dimension, list);
  }

  const rows: PreferenceAlignmentRow[] = [];
  for (const [dim, prefs] of byDim) {
    const dimTyped = dim as PreferenceAtomDimensionId;
    const cats = PREF_TO_EVIDENCE[dimTyped] ?? ["result", "project"];
    const linked = evidenceAtoms.filter((e) => cats.includes(e.category as EvidenceAtomCategoryId));
    const scores = linked.map((e) => e.strength_score);
    const alignment = avgStrength(scores);
    rows.push({
      dimension: dim,
      preferenceCount: prefs.length,
      linkedEvidenceCount: linked.length,
      alignmentScore1to6: alignment,
      matchedPreferences: prefs.map((p) => ({
        kind: "preference" as const,
        id: p.id,
        label: p.label,
        dimensionOrCategory: p.dimension,
      })),
      matchedEvidence: linked.map((e) => ({
        kind: "evidence" as const,
        id: e.id,
        label: e.label,
        dimensionOrCategory: e.category,
      })),
    });
  }
  return rows.sort((a, b) => String(a.dimension).localeCompare(String(b.dimension)));
}

export function identifyMissingEvidence(
  preferenceAtoms: { dimension: string; label: string }[],
  evidenceAtoms: { category: string }[],
): string[] {
  const missing: string[] = [];
  const evCats = new Set(evidenceAtoms.map((e) => e.category));
  const seen = new Set<string>();
  for (const p of preferenceAtoms) {
    const dim = p.dimension as PreferenceAtomDimensionId;
    const expected = PREF_TO_EVIDENCE[dim];
    if (!expected?.length) continue;
    const hasAny = expected.some((c) => evCats.has(c));
    /** Pure gap: ingen evidens-rader i det hele tatt, eller ingen i forventede kategorier. */
    if (!hasAny && evidenceAtoms.length === 0) {
      const meta = getPreferenceAtomDimensionMeta(p.dimension);
      const key = meta?.labelNb ?? p.dimension;
      if (!seen.has(`empty:${key}`)) {
        seen.add(`empty:${key}`);
        missing.push(
          `Du har preferanser innen «${key}», men ingen evidens-atomer er registrert ennå (tomt bevisgrunnlag).`,
        );
      }
      continue;
    }
    if (!hasAny && evidenceAtoms.length > 0) {
      const meta = getPreferenceAtomDimensionMeta(p.dimension);
      const key = meta?.labelNb ?? p.dimension;
      if (!seen.has(`nocat:${key}`)) {
        seen.add(`nocat:${key}`);
        missing.push(
          `Du har preferanser innen «${key}», men ingen evidens i forventede kategorier (${expected.slice(0, 3).join(", ")}).`,
        );
      }
    }
  }
  return missing;
}

/**
 * Aktiv «historie-mismatch»: det finnes evidens, men den dekker ikke preferanse-dimensjonene
 * (ulikt «mangler evidens» når arkivet er tomt — her peker dokumentasjonen andre veier).
 */
export function identifyPreferenceStoryMismatch(
  preferenceAtoms: { dimension: string }[],
  evidenceAtoms: { category: string }[],
): string[] {
  if (evidenceAtoms.length < 2) return [];
  const evCats = new Set(evidenceAtoms.map((e) => e.category));
  const out: string[] = [];
  const seen = new Set<string>();
  const dims = [...new Set(preferenceAtoms.map((p) => p.dimension))];
  for (const dim of dims) {
    const typed = dim as PreferenceAtomDimensionId;
    const expected = PREF_TO_EVIDENCE[typed];
    if (!expected?.length) continue;
    const hasLink = expected.some((c) => evCats.has(c));
    if (!hasLink && preferenceAtoms.filter((p) => p.dimension === dim).length > 0) {
      const meta = getPreferenceAtomDimensionMeta(dim);
      const key = meta?.labelNb ?? dim;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        `Preferanser sier «${key}», men eksisterende evidens ligger i andre kategorier enn forventet (${expected.slice(0, 3).join(", ")}). Vurder om narrativet bør justeres eller evidensen utvides.`,
      );
    }
  }
  return out;
}

export function identifyPositioningStrengths(evidenceAtoms: { category: string; label: string; strength_score: number | null }[]): string[] {
  const strengths: string[] = [];
  const byCat = new Map<string, typeof evidenceAtoms>();
  for (const e of evidenceAtoms) {
    const list = byCat.get(e.category) ?? [];
    list.push(e);
    byCat.set(e.category, list);
  }
  for (const [cat, list] of byCat) {
    const avg = avgStrength(list.map((x) => x.strength_score));
    const band = matchScoreBand(avg);
    if (band === "strong") {
      const meta = getEvidenceAtomCategoryMeta(cat);
      strengths.push(
        `Sterk dokumentasjon innen ${meta?.labelNb ?? cat}: ${list
          .slice(0, 2)
          .map((x) => x.label)
          .join(", ")}${list.length > 2 ? " …" : ""}`,
      );
    }
  }
  return strengths;
}

export function generateWhitespaceSummary(result: WhitespaceAnalysisResult): string {
  const parts: string[] = [];
  if (result.matchedAreas.length) parts.push(`Treffområder: ${result.matchedAreas.slice(0, 3).join(" ")}`);
  if (result.missingEvidence.length) parts.push(`Hull i evidens: ${result.missingEvidence[0] ?? ""}`.trim());
  if (result.preferenceStoryMismatch.length) parts.push(`Preferanse vs. historie: ${result.preferenceStoryMismatch[0] ?? ""}`.trim());
  if (result.positioningOpportunities.length) parts.push(`Muligheter: ${result.positioningOpportunities[0] ?? ""}`.trim());
  if (parts.length === 0) return "Legg inn preferanser og evidens-atomer for mer presis white-space-analyse.";
  return parts.join(" ");
}

function matchDimensionHints(dim: MatchDimensionId): EvidenceAtomCategoryId[] {
  switch (dim) {
    case "qualification_match":
      return ["technology", "industry", "project", "result", "certification", "education"];
    case "culture_match":
      return ["people", "communication", "leadership"];
    case "leadership_match":
      return ["leadership", "governance", "people"];
    case "industry_match":
      return ["industry", "commercial", "technology"];
    case "mission_match":
      return ["strategy", "communication", "result"];
    case "growth_match":
      return ["project", "education", "technology"];
    case "compensation_match":
      return ["finance", "commercial"];
    case "flexibility_match":
      return ["operations", "communication"];
    case "strategic_value":
      return ["strategy", "result", "commercial"];
    case "network_advantage":
      return ["network", "communication", "commercial"];
    default:
      return [];
  }
}

/**
 * Full pass: alignments, gaps, positioning hooks, optional job/company requirement strings.
 */
export function analyzeWhitespace(input: {
  preferenceAtoms: { id: string; dimension: string; label: string; importance_score: number | null }[];
  evidenceAtoms: { id: string; category: string; label: string; strength_score: number | null }[];
  targetDimensions?: MatchDimensionId[];
  jobOrCompanyRequirements?: string[];
}): WhitespaceAnalysisResult {
  const { preferenceAtoms, evidenceAtoms, targetDimensions = [], jobOrCompanyRequirements = [] } = input;

  const alignment = identifyPreferenceAlignment({ preferenceAtoms, evidenceAtoms, targetDimensions });
  const missingEvidence = identifyMissingEvidence(preferenceAtoms, evidenceAtoms);
  const storyMismatch = identifyPreferenceStoryMismatch(preferenceAtoms, evidenceAtoms);
  const strengths = identifyPositioningStrengths(evidenceAtoms);

  const weakEvidenceAreas: string[] = [];
  for (const row of alignment) {
    if (row.preferenceCount === 0) continue;
    const band = matchScoreBand(row.alignmentScore1to6);
    /** Ingen evidens i det hele tatt → «mangler evidens», ikke svak posisjonering. */
    if (row.linkedEvidenceCount === 0 && evidenceAtoms.length === 0) continue;
    /** Evidens finnes andre steder, men ikke her → preferanse-historie (håndteres i `preferenceStoryMismatch`). */
    if (row.linkedEvidenceCount === 0 && evidenceAtoms.length > 0) continue;
    if (band === "weak") {
      const meta = getPreferenceAtomDimensionMeta(String(row.dimension));
      weakEvidenceAreas.push(
        `«${meta?.labelNb ?? row.dimension}»: koblet evidens finnes, men styrken er lav (${row.linkedEvidenceCount} rader).`,
      );
    }
  }

  const matchedAreas: string[] = [];
  for (const row of alignment) {
    const band = matchScoreBand(row.alignmentScore1to6);
    if (band === "moderate" || band === "strong") {
      const meta = getPreferenceAtomDimensionMeta(String(row.dimension));
      matchedAreas.push(`${meta?.labelNb ?? row.dimension}: preferanser og evidens henger rimelig sammen.`);
    }
  }

  const positioningOpportunities: string[] = [];
  if (alignment.some((r) => r.dimension === "leadership_scope" && (matchScoreBand(r.alignmentScore1to6) === "weak" || r.linkedEvidenceCount === 0))) {
    positioningOpportunities.push("LinkedIn-profilen kan tydeliggjøre lederansvar og mandat tidlig i sammendraget.");
  }
  if (alignment.some((r) => r.dimension === "industry" && (matchScoreBand(r.alignmentScore1to6) === "weak" || r.linkedEvidenceCount === 0))) {
    positioningOpportunities.push("Trekk frem SaaS- eller produktteknologi tidligere i CV-en dersom det er relevant.");
  }
  if (weakEvidenceAreas.length && strengths.some((s) => s.includes("Kommersielt"))) {
    positioningOpportunities.push("Du har sterk kommersiell erfaring — koble den tydelig til bransjepreferansene i søknadstekst.");
  }
  if (positioningOpportunities.length === 0 && preferenceAtoms.length + evidenceAtoms.length > 0) {
    positioningOpportunities.push("Balanser narrativet mellom det du ønsker (preferanser) og det du kan bevise (evidens).");
  }

  const differentiationAngles: string[] = [...strengths.slice(0, 2)];
  if (strengths.length === 0 && evidenceAtoms.length > 0) {
    differentiationAngles.push("Bygg 1–2 målbare resultater per hovedkategori for å skille deg ut.");
  }

  const inferredRequirements: InferredRequirement[] = jobOrCompanyRequirements.map((text, i) => ({
    id: `req-${i}`,
    text,
  }));

  for (const dim of targetDimensions) {
    const hints = matchDimensionHints(dim);
    const covered = hints.some((h) => evidenceAtoms.some((e) => e.category === h));
    if (!covered) {
      inferredRequirements.push({
        id: `dim-gap-${dim}`,
        text: `Krav/tyngde for dimensjon «${dim}» antyder evidens innen: ${hints.slice(0, 4).join(", ")}.`,
        relatedDimension: dim,
      });
    }
  }

  return {
    matchedAreas,
    weakEvidenceAreas,
    missingEvidence,
    preferenceStoryMismatch: storyMismatch,
    positioningOpportunities,
    differentiationAngles,
    preferenceAlignment: alignment,
    inferredRequirements,
  };
}
