// @ts-nocheck
/**
 * Module 5.1.2 — safe automatic structuring of explicit user-owned profile/document
 * data into durable preference/evidence rows (no review queue).
 */

import { supabase } from "@/lib/supabase";
import type { TablesInsert } from "@/integrations/supabase/types";
import type { PlannedEvidenceAtom, PlannedPreferenceAtom } from "@/lib/career-atom-refresh";

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

export async function insertExplicitPreferenceFromPlan(
  userId: string,
  pl: PlannedPreferenceAtom,
): Promise<void> {
  const insert: TablesInsert<"user_preference_atoms"> = {
    user_id: userId,
    career_profile_id: pl.career_profile_id,
    dimension: pl.dimension.trim(),
    label: pl.label.trim(),
    value: pl.value,
    importance_score: pl.importance_score,
    confidence_score: pl.confidence_score ?? 1,
    source: pl.source,
    source_field: pl.source_field,
    source_hash: pl.source_hash,
    reasoning: pl.reasoning,
    is_active: true,
  };
  const { error } = await supabase.from("user_preference_atoms").insert(insert);
  if (error) throw error;
}

export async function insertExplicitEvidenceFromPlan(
  userId: string,
  ev: PlannedEvidenceAtom,
): Promise<void> {
  const insert: TablesInsert<"user_evidence_atoms"> = {
    user_id: userId,
    category: ev.category.trim(),
    label: ev.label.trim(),
    description: ev.description,
    evidence_type: ev.evidence_type,
    source: ev.source,
    source_document_id: ev.source_document_id,
    source_profile_field: ev.source_profile_field,
    source_hash: ev.source_hash,
    strength_score: ev.strength_score,
    confidence_score: ev.confidence_score ?? 1,
    reasoning: ev.reasoning,
    is_active: true,
  };
  const { error } = await supabase.from("user_evidence_atoms").insert(insert);
  if (error) throw error;
}
