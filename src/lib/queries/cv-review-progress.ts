/**
 * CV-gjennomgang: fremdrift, privat tidslinjekontekst og manuelt lagte roller.
 *
 * All skriving mot fremdrift går gjennom kontrollerte databasefunksjoner som
 * sjekker eierskap. Klienten skriver aldri direkte til fremdriftstabellen.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/integrations/supabase/types";
import { careerAtomLogicalKey } from "@/lib/career-atom-refresh";

export type CvReviewProgressRow = Tables<"cv_review_progress">;
export type CvReviewTimelineContextRow = Tables<"cv_review_timeline_context">;

export const REVIEW_ANALYSIS_VERSION = "cv_review_v4_2026_08_16";

export const cvReviewProgressQuery = (userId: string, importId: string | null) =>
  queryOptions({
    queryKey: ["cv-review-progress", userId, importId],
    queryFn: async (): Promise<CvReviewProgressRow | null> => {
      const { data, error } = await supabase
        .from("cv_review_progress")
        .select("*")
        .eq("user_id", userId)
        .eq("import_id", importId!)
        .eq("is_stale", false)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: Boolean(userId && importId),
  });

export async function syncReviewProgress(
  importId: string,
  signature: string,
): Promise<CvReviewProgressRow> {
  const { data, error } = await supabase.rpc("cv_review_progress_sync", {
    p_import_id: importId,
    p_signature: signature,
    p_analysis_version: REVIEW_ANALYSIS_VERSION,
  });
  if (error) throw error;
  return data as unknown as CvReviewProgressRow;
}

export async function advanceReviewProgress(
  importId: string,
  signature: string,
  step: number,
  stepState?: Record<string, unknown>,
): Promise<CvReviewProgressRow> {
  const { data, error } = await supabase.rpc("cv_review_progress_advance", {
    p_import_id: importId,
    p_signature: signature,
    p_step: step,
    p_step_state: (stepState ?? null) as Json,
  });
  if (error) throw error;
  return data as unknown as CvReviewProgressRow;
}

// --------------------------------------------------------------- tidslinje

export const timelineContextQuery = (userId: string) =>
  queryOptions({
    queryKey: ["cv-review-timeline-context", userId],
    queryFn: async (): Promise<CvReviewTimelineContextRow[]> => {
      const { data, error } = await supabase
        .from("cv_review_timeline_context")
        .select("*")
        .eq("user_id", userId)
        .order("gap_start", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
  });

export async function saveTimelineContext(input: {
  userId: string;
  importId: string | null;
  gapStart: string;
  gapEnd: string;
  category: string;
  note: string | null;
}): Promise<void> {
  const { error } = await supabase.from("cv_review_timeline_context").insert({
    user_id: input.userId,
    import_id: input.importId,
    gap_start: input.gapStart,
    gap_end: input.gapEnd,
    category: input.category,
    note: input.note?.trim() || null,
  });
  if (error) throw error;
}

export async function deleteTimelineContext(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("cv_review_timeline_context")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

// ---------------------------------------------------- manuelt lagte roller

export interface ManualRoleInput {
  userId: string;
  title: string;
  employer: string | null;
  startIso: string | null;
  endIso: string | null;
  isCurrent: boolean;
  importId: string | null;
}

/**
 * Bruker-lagt rolle. Kanonisk lagret kildetype er `source_type='user_input'`.
 * `kilde: "bruker_manuelt"` i structured_data er kun visningstekst/metadata og
 * har ingen regelvirkning i backend eller matching.
 */
export async function addManualRole(input: ManualRoleInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Rollen må ha en tittel.");

  const structured: Record<string, unknown> = {
    employer: input.employer?.trim() || null,
    start_date: input.startIso,
    end_date: input.isCurrent ? null : input.endIso,
    is_current: input.isCurrent,
    lagt_inn_av_bruker: true,
    kilde: "bruker_manuelt",
    review_import_id: input.importId,
  };

  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: "evidens",
    atom_type: "role",
    content_no: title,
    structured_data: structured,
  });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("career_atoms")
    .insert({
      user_id: input.userId,
      atom_kind: "evidens",
      atom_type: "role",
      content_no: title,
      structured_data: structured as Json,
      source_type: "user_input",
      source_ref: "cv_review_timeline",
      confidence: "verified",
      user_confirmed: true,
      refreshed_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Bruker-lagt resultat under en bekreftet rolle. Samme kontrollerte atomflyt og
 * provenance-regel som manuelt lagt rolle: kanonisk `source_type='user_input'`,
 * `confidence='verified'` + `user_confirmed=true` (som er atom-tillit, IKKE
 * claim-evidensstatusen `user_attested`). `kilde: "bruker_manuelt"` er kun metadata.
 */
export async function addManualResult(input: {
  userId: string;
  importId: string | null;
  title: string;
  roleAtomId: string | null;
}): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Resultatet må ha en beskrivelse.");

  const structured: Record<string, unknown> = {
    lagt_inn_av_bruker: true,
    kilde: "bruker_manuelt",
    review_import_id: input.importId,
    role_atom_id: input.roleAtomId,
  };
  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: "evidens",
    atom_type: "achievement",
    content_no: title,
    structured_data: structured,
  });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("career_atoms")
    .insert({
      user_id: input.userId,
      atom_kind: "evidens",
      atom_type: "achievement",
      parent_atom_id: input.roleAtomId,
      content_no: title,
      structured_data: structured as Json,
      source_type: "user_input",
      source_ref: "cv_review_results",
      confidence: "verified",
      user_confirmed: true,
      refreshed_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export function invalidateReviewProgress(qc: QueryClient, userId: string): void {
  void qc.invalidateQueries({ queryKey: ["cv-review-progress", userId] });
  void qc.invalidateQueries({ queryKey: ["cv-review-timeline-context", userId] });
}
