/**
 * CV-gjennomgang, trinn 3: review-basis for kompetanse.
 *
 * Kanonisk regel: for en v2.1-import er `atom_enrichment_proposals` autoritet
 * for kompetansens canonical label/key, hvilke roller og resultater som
 * understøtter den, sikkerhetsnivå og direktehet i belegget.
 *
 * Modellregel: **bredde er ikke opptaksterskel**. En kompetanse som er
 * eksplisitt oppgitt, eller som har konkret belegg i én rolle eller ett
 * resultat, vises i Trinn 3 med sin faktiske beleggstatus. Bredde er
 * informasjon, ikke filter.
 *
 * `cv_parse_candidates` er kilde og provenance — den styrer aldri alene
 * plasseringen. Modulen gjetter aldri kobling fra tekstlikhet, skriver
 * ingenting, og forhåndsvelger aldri en rolle (heller ikke Privat eller
 * Freelance) uten dokumentert belegg.
 */
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";
import type { SuggestionRole, SuggestionResult } from "@/lib/cv-review-skill-suggestions";

export type SkillTier = "reviewable" | "local_signal";

/** Hvor direkte belegget er. */
export type SkillDirectness = "direct" | "semantic" | "none";

/** Bredden i belegget. Vises som informasjon, aldri som terskel. */
export type SkillBreadth = "multiple_roles" | "single_role" | "single_result" | "none";

export interface SkillProposalRow {
  id: string;
  payload: {
    atom_type?: string;
    content_no?: string | null;
    structured_data?: Record<string, unknown> | null;
  };
}

export interface SkillBasisItem {
  proposalId: string;
  canonicalKey: string;
  title: string;
  tier: SkillTier;
  /** Kandidatraden kompetansen kom fra. Kreves for bekreftelse. */
  candidate: CvParseCandidateRow;
  /** Roller med faktisk kildebelegg. Forhåndsvelges. */
  roles: SuggestionRole[];
  /** Kun resultater som inngår i kompetansens evidence refs. */
  results: SuggestionResult[];
  /** Atomtypen kompetansen skal promoteres som. Kommer fra forslaget. */
  atomType: "skill" | "domain";
  /** v2.1s placement_confidence. */
  confidence: string | null;
  /** v2.1s placement_source, uendret. */
  placementSource: string | null;
  directness: SkillDirectness;
  breadth: SkillBreadth;
  /** Eksplisitt oppgitt som kompetanse i CV-en. */
  explicit: boolean;
  reason: string;
  /** Ingen dokumentert rolle/resultat: brukeren må plassere selv. */
  needsPlacement: boolean;
}

export interface SkillBasis {
  items: SkillBasisItem[];
  /** Utledede signaler uten konkret rolle-/resultatbelegg — hører til Trinn 2. */
  localSignals: { canonicalKey: string; title: string }[];
  /** Rå kompetansekandidater uten v2.1-forslag — avvik, ikke tomme kort. */
  deviations: CvParseCandidateRow[];
}

function sd(p: SkillProposalRow): Record<string, unknown> {
  return p.payload.structured_data ?? {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function buildSkillBasis(input: {
  proposals: SkillProposalRow[];
  skillCandidates: CvParseCandidateRow[];
  /** Alle kandidater i importen. Et kompetanseforslag kan ha proveniens i en
   *  resultatlinje (f.eks. en metodikk nevnt i et resultat) — da finnes ikke
   *  kilderaden blant kompetansekandidatene. */
  allCandidates?: CvParseCandidateRow[];
  roles: SuggestionRole[];
  results: SuggestionResult[];
  /** local_ref → promotert atom-id, fra bekreftede kandidater. */
  promotedByLocalRef: Map<string | null, string | null>;
}): SkillBasis {
  const roleById = new Map(input.roles.map((r) => [r.atomId, r] as const));
  const resultById = new Map(input.results.map((r) => [r.atomId, r] as const));
  const lookupRows = [...(input.allCandidates ?? []), ...input.skillCandidates];
  const candidateById = new Map(lookupRows.map((c) => [c.id, c] as const));
  const candidateByRef = new Map(lookupRows.map((c) => [c.local_ref, c] as const));

  // v2.1 local_id → promotert atom-id, via parselagets local_ref.
  const roleAtomByLocalId = new Map<string, string>();
  const resultAtomByLocalId = new Map<string, string>();
  const roleLocalIdByResultLocalId = new Map<string, string>();

  for (const p of input.proposals) {
    const type = p.payload.atom_type;
    const data = sd(p);
    const localId = str(data["local_id"]);
    const ref = str(data["parse_local_ref"]);
    if (!localId || !ref) continue;
    const atomId = input.promotedByLocalRef.get(ref) ?? null;
    if (type === "role") {
      if (atomId) roleAtomByLocalId.set(localId, atomId);
    } else if (type === "achievement" || type === "role_evidence") {
      if (atomId) resultAtomByLocalId.set(localId, atomId);
      const rl = str(data["role_local_id"]);
      if (rl) roleLocalIdByResultLocalId.set(localId, rl);
    }
  }

  const items: SkillBasisItem[] = [];
  const localSignals: SkillBasis["localSignals"] = [];
  const usedCandidateIds = new Set<string>();

  for (const p of input.proposals) {
    if (p.payload.atom_type !== "skill" && p.payload.atom_type !== "domain") continue;
    const data = sd(p);
    const canonicalKey = str(data["canonical_key"]) ?? "";
    const title =
      str(data["display_label"]) ?? str(p.payload.content_no ?? null) ?? canonicalKey ?? "";
    const tier: SkillTier = data["skill_tier"] === "local_signal" ? "local_signal" : "reviewable";
    const explicit = data["skill_explicit"] === true;

    const candidate =
      (str(data["parse_candidate_id"]) && candidateById.get(str(data["parse_candidate_id"])!)) ||
      (str(data["parse_local_ref"]) && candidateByRef.get(str(data["parse_local_ref"])!)) ||
      null;

    // Eksplisitte evidenspekere — aldri tekstlikhet.
    const roleIds = new Set<string>();
    const resultIds = new Set<string>();
    const refs = Array.isArray(data["evidence_refs"]) ? (data["evidence_refs"] as unknown[]) : [];
    for (const raw of refs) {
      if (!raw || typeof raw !== "object") continue;
      const ref = raw as Record<string, unknown>;
      const roleLocalId = str(ref["role_local_id"]);
      const achLocalId = str(ref["achievement_local_id"]);
      if (achLocalId) {
        const atomId = resultAtomByLocalId.get(achLocalId);
        if (atomId && resultById.has(atomId)) resultIds.add(atomId);
        const viaRole = roleLocalIdByResultLocalId.get(achLocalId);
        if (viaRole) {
          const roleAtom = roleAtomByLocalId.get(viaRole);
          if (roleAtom && roleById.has(roleAtom)) roleIds.add(roleAtom);
        }
      }
      if (roleLocalId) {
        const roleAtom = roleAtomByLocalId.get(roleLocalId);
        if (roleAtom && roleById.has(roleAtom)) roleIds.add(roleAtom);
      }
    }

    const roles = [...roleIds].map((id) => roleById.get(id)!).filter(Boolean);
    const results = [...resultIds].map((id) => resultById.get(id)!).filter(Boolean);
    const hasConcreteEvidence = roles.length > 0 || results.length > 0;

    // Bredde skjuler aldri en kompetanse. Et element havner bare i lokale
    // signaler når det verken er eksplisitt oppgitt eller har konkret belegg.
    if (!hasConcreteEvidence && !explicit && tier === "local_signal") {
      localSignals.push({ canonicalKey, title });
      if (candidate) usedCandidateIds.add(candidate.id);
      continue;
    }
    if (!candidate) continue;
    usedCandidateIds.add(candidate.id);

    const placementSource = str(data["placement_source"]);
    const directness: SkillDirectness = !hasConcreteEvidence
      ? "none"
      : placementSource === "semantic_evidence_match"
        ? "semantic"
        : "direct";
    const breadth: SkillBreadth =
      roles.length >= 2
        ? "multiple_roles"
        : roles.length === 1
          ? "single_role"
          : results.length >= 1
            ? "single_result"
            : "none";

    items.push({
      proposalId: p.id,
      canonicalKey,
      title,
      tier,
      candidate,
      atomType: p.payload.atom_type === "domain" ? "domain" : "skill",
      roles,
      results,
      confidence: str(data["placement_confidence"]),
      placementSource,
      directness,
      breadth,
      explicit,
      reason: str(data["placement_reason"]) ?? buildReason(roles, results, directness),
      needsPlacement: !hasConcreteEvidence,
    });
  }

  const deviations = input.skillCandidates.filter((c) => !usedCandidateIds.has(c.id));
  return { items, localSignals, deviations };
}

function buildReason(
  roles: SuggestionRole[],
  results: SuggestionResult[],
  directness: SkillDirectness,
): string {
  if (roles.length === 0 && results.length === 0) {
    return "CV-analysen fant ingen rolle eller resultat som belegger kompetansen. Velg selv hvor den hører hjemme.";
  }
  const roleText = roles
    .map((r) => (r.employer ? `${r.title} i ${r.employer}` : r.title))
    .join(", ");
  const resultText = results.map((r) => `«${shorten(r.title)}»`).join(", ");
  const prefix = directness === "semantic" ? "Tolket kobling til" : "Koblet til";
  if (roleText && resultText) return `${prefix} ${roleText} og resultatet ${resultText}.`;
  if (roleText) return `${prefix} ${roleText}.`;
  return `${prefix} resultatet ${resultText}.`;
}

function shorten(value: string, max = 60): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

export const SKILL_PLACEMENT_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Høy sikkerhet",
  medium: "Middels sikkerhet",
  low: "Lav sikkerhet",
};

export const SKILL_DIRECTNESS_LABEL: Record<SkillDirectness, string> = {
  direct: "Direkte belegg",
  semantic: "Semantisk forslag",
  none: "Uten belegg",
};

export const SKILL_BREADTH_LABEL: Record<SkillBreadth, string> = {
  multiple_roles: "Dokumentert i flere roller",
  single_role: "Dokumentert i én rolle",
  single_result: "Dokumentert i ett resultat",
  none: "Ingen dokumentert bredde",
};
