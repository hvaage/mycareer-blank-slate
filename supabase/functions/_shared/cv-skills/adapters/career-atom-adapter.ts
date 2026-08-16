// Adapter mellom kanonisk v4-runtime (public.career_atoms) og isolert
// leverandørkode (supabase/functions/_shared/cv-skills/vendor/**, skill-v2).
//
// Prinsipp: v2 og v4 slås ALDRI sammen. v4 er kanonisk. Leverandørkoden er
// uendret og kjenner ikke v4. Denne filen er eneste kobling mellom dem, og
// oversetter kun én vei: v4-rad -> leverandørens lesemodell.
//
// Denne filen skriver aldri til databasen.

import type {
  AtomType as VendorAtomType,
  Confidence as VendorConfidence,
  CvAtom,
  SourceType as VendorSourceType,
} from "../vendor/cv-evidence-graph/scripts/types.ts";
import type { ReadinessReason, ReadinessReport } from "../contract.ts";

/** Rad slik den ligger i public.career_atoms (v4). Kun feltene adapteret bruker. */
export type CareerAtomRow = {
  id: string;
  user_id: string;
  atom_kind: string;
  atom_type: string | null;
  atom_class: string | null;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: unknown;
  source_type: string | null;
  source_ref: string | null;
  source_quote: string | null;
  confidence: string | null;
  attestation: string | null;
  state: string | null;
  mangel_state: string | null;
  user_confirmed: boolean | null;
  user_locked: boolean | null;
  is_active: boolean | null;
  stale_at: string | null;
  target_position_id: string | null;
  created_at: string;
  updated_at: string;
};

const VENDOR_ATOM_TYPES: readonly VendorAtomType[] = [
  "role",
  "achievement",
  "metric",
  "context",
  "tool",
  "education",
  "skill",
  "language",
  "certification",
  "project",
  "volunteer",
  "summary_fragment",
];

const VENDOR_SOURCE_TYPES: readonly VendorSourceType[] = [
  "linkedin_oauth",
  "linkedin_zip",
  "linkedin_pdf",
  "old_cv_pdf",
  "old_cv_docx",
  "interview",
  "manual",
  "about_me_profile",
  "onboarding",
];

/** v4-klasse -> leverandørens atom_type når atom_type mangler på raden. */
const CLASS_TO_VENDOR_TYPE: Record<string, VendorAtomType> = {
  resultat: "achievement",
  kvalifikasjon: "certification",
  kompetanse: "skill",
  eksponering: "context",
  instrument: "tool",
};

function toVendorAtomType(row: CareerAtomRow): VendorAtomType | null {
  const t = row.atom_type ?? "";
  if ((VENDOR_ATOM_TYPES as readonly string[]).includes(t)) return t as VendorAtomType;
  const c = row.atom_class ?? "";
  return CLASS_TO_VENDOR_TYPE[c] ?? null;
}

function toVendorConfidence(value: string | null): VendorConfidence {
  // Ukjente verdier degraderes til den svakeste — aldri oppgraderes.
  if (value === "verified" || value === "imported" || value === "inferred") return value;
  return "inferred";
}

function toVendorSourceType(value: string | null): VendorSourceType {
  if (value && (VENDOR_SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as VendorSourceType;
  }
  return "manual";
}

/**
 * Oversetter én v4-rad til leverandørens lesemodell.
 * Returnerer null når raden ikke har en meningsfull motpart i v2 — da skal
 * den utelates, ikke tvinges inn i feil type.
 */
export function toVendorAtom(row: CareerAtomRow): CvAtom | null {
  const atomType = toVendorAtomType(row);
  if (!atomType) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    atom_type: atomType,
    parent_atom_id: row.parent_atom_id,
    content_no: row.content_no,
    content_en: row.content_en,
    structured_data: (row.structured_data ?? null) as never,
    source_type: toVendorSourceType(row.source_type),
    source_ref: row.source_ref,
    source_quote: row.source_quote,
    confidence: toVendorConfidence(row.confidence),
    user_confirmed: row.user_confirmed === true,
    user_locked: row.user_locked === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as CvAtom;
}

export function toVendorAtoms(rows: CareerAtomRow[]): CvAtom[] {
  const out: CvAtom[] = [];
  for (const row of rows) {
    const atom = toVendorAtom(row);
    if (atom) out.push(atom);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Eligibility og readiness — kanonisk definisjon, v4-side
// ---------------------------------------------------------------------------

/**
 * Kan atomet brukes som faktagrunnlag i generering?
 *
 * `stale_at` gir varsel, ikke blokkering: historiske fakta blir ikke usanne
 * av alder. `imported` og `inferred` blir aldri faktagrunnlag.
 */
export function isEligibleAtom(
  row: CareerAtomRow,
  opts: { opportunityId?: string | null } = {},
): boolean {
  if (row.is_active !== true) return false;
  if (row.atom_kind !== "evidens") return false;
  if (row.confidence !== "verified") return false;
  if (row.user_confirmed !== true) return false;
  if (row.state && row.state !== "aktiv") return false;
  if (row.mangel_state) return false;
  const target = row.target_position_id;
  if (target && target !== (opts.opportunityId ?? null)) return false;
  return true;
}

export function eligibleAtoms(
  rows: CareerAtomRow[],
  opts: { opportunityId?: string | null } = {},
): CareerAtomRow[] {
  return rows.filter((row) => isEligibleAtom(row, opts));
}

/**
 * Readiness for generering.
 *
 * Formell rolle er ikke et absolutt krav: en bruker med annet eligible
 * grunnlag (resultat, kvalifikasjon) kan generere. Antall resultat-atomer er
 * en kvalitetsindikator som gir `ready_with_gaps`, ikke blokkering. Manglende
 * avledet kompetanse gir aldri gap alene.
 */
export function assessReadiness(input: {
  rows: CareerAtomRow[];
  opportunityId?: string | null;
  openProposals?: number;
  conflicts?: number;
  unsupportedRequirements?: number;
}): ReadinessReport {
  const eligible = eligibleAtoms(input.rows, { opportunityId: input.opportunityId ?? null });
  const roles = eligible.filter((r) => r.atom_type === "role").length;
  const results = eligible.filter((r) => r.atom_class === "resultat").length;
  const qualifications = eligible.filter((r) => r.atom_class === "kvalifikasjon").length;
  const derivedCompetence = input.rows.filter(
    (r) => r.is_active === true && r.atom_class === "kompetanse",
  ).length;
  const openProposals = input.openProposals ?? 0;
  const conflicts = input.conflicts ?? 0;
  const unsupported = input.unsupportedRequirements ?? 0;

  const counts = {
    eligible: eligible.length,
    roles,
    results,
    qualifications,
    derivedCompetence,
    openProposals,
    conflicts,
  };

  const reasons: ReadinessReason[] = [];

  if (eligible.length === 0) {
    return { status: "blocked_no_evidence", reasons: ["no_eligible_atoms"], counts };
  }
  if (conflicts > 0) reasons.push("unresolved_conflicts");
  if (openProposals > 0) reasons.push("open_proposals");
  if (conflicts > 0) {
    return { status: "needs_review", reasons, counts };
  }
  if (results < 2) reasons.push("few_results");
  if (unsupported > 0) reasons.push("unsupported_requirements");
  if (reasons.length > 0) {
    return { status: "ready_with_gaps", reasons, counts };
  }
  return { status: "ready", reasons, counts };
}
