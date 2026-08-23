/**
 * Module 5.1.2 — safe automatic structuring of explicit user-owned profile/document
 * data into durable atoms (no review queue).
 * Karriereontologi v4: skriver til `career_atoms`.
 */

import { supabase } from "@/lib/supabase";
import type { Json, TablesInsert } from "@/integrations/supabase/types";
import type { PlannedEvidenceAtom, PlannedPreferenceAtom } from "@/lib/career-atom-refresh";
import {
  evidencePlanToCareerAtom,
  preferencePlanToCareerAtom,
  type CareerAtomFields,
  type CareerAtomType,
} from "@/lib/career-atom-v4-mapping";

const SLIDER_OR_SCALE_FIELDS = new Set([
  "mission_importance",
  "innovation_importance",
  "sustainability_importance",
  "work_life_balance_importance",
  "compensation_importance",
  "leadership_ambition",
  "stability_vs_growth",
]);

/**
 * User typed or chose values in structured profile/career forms — safe to mirror
 * into preference atoms without a review step (when no conflicting manual row exists).
 */
export function isExplicitStructuredPreference(pl: PlannedPreferenceAtom): boolean {
  const sf = pl.source_field ?? "";
  if (SLIDER_OR_SCALE_FIELDS.has(sf)) return false;
  if (pl.dimension === "leadership_scope") return false;

  if (pl.source === "career_profile") {
    if (sf.startsWith("desired_role_types:")) return true;
    if (sf.startsWith("desired_industries:")) return true;
    if (sf.startsWith("preferred_company_sizes:")) return true;
    if (sf.startsWith("preferred_work_styles:")) return true;
    if (sf.startsWith("preferred_locations:")) return true;
    if (sf === "remote_preference" || sf === "travel_preference") return true;
    return false;
  }

  if (pl.source === "profile") {
    if (sf.startsWith("target_roles:") || sf === "target_role") return true;
    if (sf.startsWith("target_industries:")) return true;
    if (sf.startsWith("preferred_locations:")) return true;
    if (sf.startsWith("work_types:")) return true;
    return false;
  }

  return false;
}

/**
 * Fakta brukeren allerede har lagt inn (profilfelt, dokumenter, vellykket CV-kilde) —
 * speiles som dokumentert erfaring uten godkjenningskø.
 * Utenom: nettverks-/tolkningsfunn (f.eks. ren LinkedIn-kobling) som fortsatt bør gjennomgås.
 */
export function isAutoStructurableEvidence(
  ev: PlannedEvidenceAtom,
  opts: { skipCvEvidenceSummary: boolean },
): boolean {
  if (ev.source === "linkedin") return false;
  if (opts.skipCvEvidenceSummary && ev.source_field === "cv_evidence_atoms:summary") return false;

  if (ev.source === "profile") {
    const sf = ev.source_profile_field ?? ev.source_field ?? "";
    if (sf === "years_experience" || sf === "cv_paths") return true;
    if (sf.startsWith("industries:")) return true;
    if (sf.startsWith("skills:")) return true;
    if (sf.startsWith("languages:")) return true;
    if (sf === "current_role_title" || sf === "current_employer" || sf === "linkedin_headline")
      return true;
    return false;
  }

  if (ev.source === "document") return true;
  if (ev.source === "cv_import") return true;

  return false;
}

/** Felles innsetting. `atom_class` og `attestation` settes aldri her — databasen eier dem. */
export async function insertCareerAtomFields(
  userId: string,
  fields: CareerAtomFields,
): Promise<string> {
  const insert: TablesInsert<"career_atoms"> = {
    user_id: userId,
    atom_kind: fields.atom_kind,
    atom_type: fields.atom_type,
    parent_atom_id: fields.parent_atom_id,
    content_no: fields.content_no,
    structured_data: fields.structured_data as Json,
    source_type: fields.source_type,
    source_ref: fields.source_ref,
    source_quote: fields.source_quote,
    evidence_atom_ids: fields.evidence_atom_ids,
    confidence: fields.confidence,
    viktighet: fields.viktighet,
    // Kun manuelle skriveveier er bekreftet ved innlegging; import må bekreftes eksplisitt.
    user_confirmed: fields.source_type === "manual",
    is_active: true,
  };
  const { data, error } = await supabase
    .from("career_atoms")
    .insert(insert)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function insertExplicitPreferenceFromPlan(
  userId: string,
  pl: PlannedPreferenceAtom,
): Promise<string> {
  return insertCareerAtomFields(userId, preferencePlanToCareerAtom(pl));
}

export async function insertExplicitEvidenceFromPlan(
  userId: string,
  ev: PlannedEvidenceAtom,
  opts: { atomType: CareerAtomType; evidenceAtomIds: string[]; parentAtomId: string | null },
): Promise<string> {
  return insertCareerAtomFields(userId, evidencePlanToCareerAtom(ev, opts));
}

