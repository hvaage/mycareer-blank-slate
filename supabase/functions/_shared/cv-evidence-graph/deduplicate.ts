// cv-evidence-graph — Deduplication
// Skjema-versjon: 4.0 (parselaget)
//
// Finner duplikater mellom nye parsekandidater og kandidater som allerede
// ligger i importen. Dedup skjer FØR brukeren har sett noe, og slår aldri
// sammen bekreftet evidens — det hører til career_atoms.

import type {
  CvParseCandidate,
  CandidateDraft,
  RoleStructuredData,
  AchievementStructuredData,
  EducationStructuredData,
  SkillStructuredData,
  LanguageStructuredData,
  CertificationStructuredData,
  ProjectStructuredData,
} from "./types.ts";

type IncomingCandidate = CandidateDraft | CvParseCandidate;
type ExistingCandidate = CvParseCandidate;

function typeOf(c: IncomingCandidate | ExistingCandidate): string {
  return (
    ("resolved_atom_type" in c ? c.resolved_atom_type : null) ??
    c.suggested_atom_type
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DuplicatePair<TIncoming, TExisting> {
  incoming: TIncoming;
  existing: TExisting;
  reason: string;
  confidence: number;     // 0–1, høyere er mer sikker
}

/**
 * Finn duplikater mellom inkommende atoms og brukerens eksisterende atoms.
 * Returner kun par hvor begge atoms har samme atom_type.
 */
export function findDuplicates(
  incoming: AtomInsert[],
  existing: CvAtom[],
): DuplicatePair<AtomInsert, CvAtom>[] {
  const pairs: DuplicatePair<AtomInsert, CvAtom>[] = [];

  for (const inc of incoming) {
    for (const ex of existing) {
      if (inc.atom_type !== ex.atom_type) continue;
      const match = compareAtoms(inc, ex);
      if (match) {
        pairs.push({ incoming: inc, existing: ex, ...match });
        break; // én eksisterende match per inkommende — første treff vinner
      }
    }
  }

  return pairs;
}

/**
 * Slå sammen to atoms — beholder mest detaljert structured_data og lengste content.
 * Resultatet er en oppdatering klar for Supabase update.
 */
export function mergeAtoms(
  existing: CvAtom,
  incoming: AtomInsert,
): Partial<CvAtom> {
  const merged = {
    content_no: pickLonger(existing.content_no, incoming.content_no),
    content_en: pickLonger(existing.content_en, incoming.content_en),
    structured_data: mergeStructuredData(
      existing.structured_data as unknown as Record<string, unknown>,
      incoming.structured_data as unknown as Record<string, unknown>,
    ),
    confidence: pickHigherConfidence(
      existing.confidence,
      incoming.confidence ?? "imported",
    ),
    source_ref: existing.source_ref ?? incoming.source_ref,
  };
  // Cast til Partial<CvAtom> — vi vet structured_data matcher existing.atom_type fordi vi sjekket det i compareAtoms
  return merged as unknown as Partial<CvAtom>;
}

// ---------------------------------------------------------------------------
// Per-type comparators
// ---------------------------------------------------------------------------

function compareAtoms(
  inc: AtomInsert,
  ex: CvAtom,
): { reason: string; confidence: number } | null {
  switch (inc.atom_type) {
    case "role":
      return compareRoles(
        inc.structured_data as Partial<RoleStructuredData>,
        ex.structured_data as RoleStructuredData,
      );
    case "achievement":
      return compareAchievements(inc, ex);
    case "education":
      return compareEducation(
        inc.structured_data as Partial<EducationStructuredData>,
        ex.structured_data as EducationStructuredData,
      );
    case "skill":
      return compareSkills(
        inc.structured_data as Partial<SkillStructuredData>,
        ex.structured_data as SkillStructuredData,
      );
    case "language":
      return compareLanguages(
        inc.structured_data as Partial<LanguageStructuredData>,
        ex.structured_data as LanguageStructuredData,
      );
    case "certification":
      return compareCertifications(
        inc.structured_data as Partial<CertificationStructuredData>,
        ex.structured_data as CertificationStructuredData,
      );
    case "project":
      return compareProjects(
        inc.structured_data as Partial<ProjectStructuredData>,
        ex.structured_data as ProjectStructuredData,
      );
    default:
      return null; // metric, context, tool, volunteer, summary_fragment har ikke automatisk dedup
  }
}

function compareRoles(
  a: Partial<RoleStructuredData>,
  b: RoleStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.employer || !a.title || !a.start_date) return null;

  const employerMatch =
    normalize(a.employer) === normalize(b.employer) ||
    normalize(a.employer_normalized) === normalize(b.employer_normalized);
  if (!employerMatch) return null;

  const titleMatch = normalize(a.title) === normalize(b.title);
  if (!titleMatch) return null;

  // Sjekk overlapp i tidsperiode
  const overlap = datesOverlap(a.start_date, a.end_date, b.start_date, b.end_date);
  if (!overlap) return null;

  // Eksakt-match på dato gir høyere konfidens
  const exactStart = a.start_date === b.start_date;
  const confidence = exactStart ? 0.95 : 0.8;

  return {
    reason: `Samme arbeidsgiver+tittel med overlappende tidsperiode${
      exactStart ? " og samme startdato" : ""
    }`,
    confidence,
  };
}

function compareAchievements(
  inc: AtomInsert,
  ex: CvAtom,
): { reason: string; confidence: number } | null {
  // Achievement-dedup kun hvis samme parent_atom_id (samme rolle)
  if (inc.parent_atom_id !== ex.parent_atom_id) return null;

  const aWhat = (inc.structured_data as Partial<AchievementStructuredData>)?.what;
  const bWhat = (ex.structured_data as AchievementStructuredData)?.what;

  if (!aWhat || !bWhat) return null;

  const sim = jaccardSimilarity(aWhat, bWhat);
  if (sim >= 0.7) {
    return {
      reason: `Lignende prestasjon under samme rolle (Jaccard=${sim.toFixed(2)})`,
      confidence: Math.min(0.9, sim),
    };
  }
  return null;
}

function compareEducation(
  a: Partial<EducationStructuredData>,
  b: EducationStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.institution || !a.degree) return null;

  const instMatch =
    normalize(a.institution) === normalize(b.institution) ||
    normalize(a.institution_normalized) === normalize(b.institution_normalized);
  if (!instMatch) return null;

  const degMatch = normalize(a.degree) === normalize(b.degree);
  if (!degMatch) return null;

  const yearOverlap =
    a.start_year === b.start_year ||
    (a.end_year && a.end_year === b.end_year);

  return {
    reason: `Samme institusjon og grad${yearOverlap ? " og overlappende år" : ""}`,
    confidence: yearOverlap ? 0.95 : 0.85,
  };
}

function compareSkills(
  a: Partial<SkillStructuredData>,
  b: SkillStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.name) return null;
  const aName = normalize(a.name);
  const bName = normalize(b.name);
  if (aName === bName) {
    return { reason: "Identisk skill-navn", confidence: 1.0 };
  }
  if (aName === normalize(b.name_normalized) || normalize(a.name_normalized) === bName) {
    return { reason: "Match på normalisert skill-navn", confidence: 0.95 };
  }
  return null;
}

function compareLanguages(
  a: Partial<LanguageStructuredData>,
  b: LanguageStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.language) return null;
  if (normalize(a.language) === normalize(b.language)) {
    return { reason: "Samme språk", confidence: 1.0 };
  }
  return null;
}

function compareCertifications(
  a: Partial<CertificationStructuredData>,
  b: CertificationStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.name || !a.issuer) return null;
  const nameMatch = normalize(a.name) === normalize(b.name);
  const issuerMatch = normalize(a.issuer) === normalize(b.issuer);
  if (nameMatch && issuerMatch) {
    return { reason: "Samme sertifikatnavn og utsteder", confidence: 0.95 };
  }
  return null;
}

function compareProjects(
  a: Partial<ProjectStructuredData>,
  b: ProjectStructuredData,
): { reason: string; confidence: number } | null {
  if (!a.name) return null;
  if (normalize(a.name) === normalize(b.name)) {
    return { reason: "Identisk prosjektnavn", confidence: 0.9 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner
// ---------------------------------------------------------------------------

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-_./,]+/g, " ")
    .replace(/\s+/g, " ");
}

function datesOverlap(
  aStart: string,
  aEnd: string | null | undefined,
  bStart: string,
  bEnd: string | null | undefined,
): boolean {
  // YYYY-MM streng-sammenligning fungerer leksikografisk
  const aE = aEnd ?? "9999-12";
  const bE = bEnd ?? "9999-12";
  return aStart <= bE && bStart <= aE;
}

function jaccardSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

function pickLonger(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const aLen = a?.trim().length ?? 0;
  const bLen = b?.trim().length ?? 0;
  if (aLen === 0 && bLen === 0) return null;
  return aLen >= bLen ? a! : b!;
}

function mergeStructuredData(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b ?? {})) {
    const existing = merged[key];
    if (existing == null || existing === "") {
      merged[key] = value;
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      // Slå sammen arrays uten duplikater
      const set = new Set([...existing, ...value]);
      merged[key] = Array.from(set);
    }
    // Ellers: behold eksisterende
  }
  return merged;
}

function pickHigherConfidence(
  a: "verified" | "imported" | "inferred",
  b: "verified" | "imported" | "inferred",
): "verified" | "imported" | "inferred" {
  const rank = { verified: 3, imported: 2, inferred: 1 };
  return rank[a] >= rank[b] ? a : b;
}
