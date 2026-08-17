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

// ---------------------------------------------------- stillingstittel

/**
 * Brukeren oppgir stillingstittelen når importen ikke fant den. Tittelen
 * lagres i strukturfeltet `title` — rollebeskrivelsen i `content_no` røres
 * ikke, slik at kildeteksten forblir sporbar.
 */
export async function setRoleTitle(input: {
  userId: string;
  kind: "kandidat" | "lagret";
  id: string;
  title: string;
}): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error("Skriv inn stillingstittelen.");
  const table = input.kind === "kandidat" ? "cv_parse_candidates" : "career_atoms";

  const { data: row, error: readError } = await supabase
    .from(table)
    .select("structured_data")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .single();
  if (readError) throw readError;

  const structured = {
    ...(((row?.structured_data as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >),
    title,
    title_oppgitt_av_bruker: true,
  };

  const { error } = await supabase
    .from(table)
    .update({ structured_data: structured as Json })
    .eq("id", input.id)
    .eq("user_id", input.userId);
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
    title,
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
 * Bruker-lagt resultat under en bekreftet rolle. Går gjennom den kontrollerte
 * atomflyten i RPC-en `career_atom_add_manual_result`, som i samme transaksjon:
 *   1) oppretter career_atoms-raden med source_type='user_input'
 *   2) oppretter aktiv career_atom_links-rad med link_type='oppnadd_i'
 *   3) kjører career_atom_project_parent(resultat_atom_id)
 * parent_atom_id skrives aldri direkte herfra — den er en
 * kompatibilitetsprojeksjon eid av den kanoniske oppnadd_i-lenken.
 * `confidence='verified'` + `user_confirmed=true` er atom-tillit, IKKE
 * claim-evidensstatusen `user_attested`. `kilde: "bruker_manuelt"` er metadata.
 */
export async function addManualResult(input: {
  userId: string;
  importId: string | null;
  title: string;
  roleAtomId: string | null;
}): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Resultatet må ha en beskrivelse.");
  if (!input.roleAtomId) throw new Error("Resultatet må plasseres under en rolle.");

  const { data, error } = await supabase.rpc("career_atom_add_manual_result", {
    p_title: title,
    p_role_atom_id: input.roleAtomId,
    p_review_import_id: input.importId,
    p_structured_data: {} as Json,
  });
  if (error) throw error;
  const atomId = (data as { atom_id?: string } | null)?.atom_id;
  if (!atomId) throw new Error("Kunne ikke opprette resultatet.");
  return atomId;
}


export function invalidateReviewProgress(qc: QueryClient, userId: string): void {
  void qc.invalidateQueries({ queryKey: ["cv-review-progress", userId] });
  void qc.invalidateQueries({ queryKey: ["cv-review-timeline-context", userId] });
}

// ---------------------------------------------------- ansettelsesperiode

/**
 * Brukeren retter ansettelsesperioden. Datoene lagres i strukturfeltet slik
 * brukeren oppgir dem; kildeteksten røres ikke.
 */
export async function setRolePeriod(input: {
  userId: string;
  kind: "kandidat" | "lagret";
  id: string;
  startIso: string | null;
  endIso: string | null;
  isCurrent: boolean;
}): Promise<void> {
  const table = input.kind === "kandidat" ? "cv_parse_candidates" : "career_atoms";

  const { data: row, error: readError } = await supabase
    .from(table)
    .select("structured_data")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .single();
  if (readError) throw readError;

  const structured = {
    ...(((row?.structured_data as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
    start_date: input.startIso,
    end_date: input.isCurrent ? null : input.endIso,
    is_current: input.isCurrent,
    periode_oppgitt_av_bruker: true,
  };

  const { error } = await supabase
    .from(table)
    .update({ structured_data: structured as Json })
    .eq("id", input.id)
    .eq("user_id", input.userId);
  if (error) throw error;
}

/** Brukeren retter arbeidsgiveren på en rolle. */
export async function setRoleEmployer(input: {
  userId: string;
  kind: "kandidat" | "lagret";
  id: string;
  employer: string | null;
}): Promise<void> {
  const table = input.kind === "kandidat" ? "cv_parse_candidates" : "career_atoms";

  const { data: row, error: readError } = await supabase
    .from(table)
    .select("structured_data")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .single();
  if (readError) throw readError;

  const structured = {
    ...(((row?.structured_data as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
    employer: input.employer?.trim() || null,
  };

  const { error } = await supabase
    .from(table)
    .update({ structured_data: structured as Json })
    .eq("id", input.id)
    .eq("user_id", input.userId);
  if (error) throw error;
}

// ---------------------------------------------------- rollevalg i trinn 2

/**
 * Et påbegynt rollevalg for et resultat er review-state, ikke evidens. Det
 * lagres i `cv_review_progress.step_state.role_choices` (nøkkel =
 * kandidat-id) gjennom den kontrollerte RPC-en
 * `cv_review_set_role_choice`. Ingenting skrives til `career_atoms` eller
 * `career_atom_links` før brukeren bekrefter.
 */
export function readRoleChoices(row: CvReviewProgressRow | null): Record<string, string> {
  const state = (row?.step_state as Record<string, unknown> | null) ?? {};
  const raw = state["role_choices"];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export async function setResultRoleChoice(input: {
  importId: string;
  signature: string;
  candidateId: string;
  choice: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("cv_review_set_role_choice", {
    p_import_id: input.importId,
    p_signature: input.signature,
    p_candidate_id: input.candidateId,
    p_choice: input.choice,
  });
  if (error) throw error;
}

/**
 * Kanonisk bekreftelse av et resultat under en valgt rolle. RPC-en
 * `cv_review_promote_result` oppretter resultatatomet, oppretter/gjenbruker
 * den aktive `oppnadd_i`-lenken og kjører `career_atom_project_parent`.
 * `parent_atom_id` skrives aldri direkte herfra. Dette er atom-tillit og
 * påvirker ikke claim-attestasjoner (`user_attested`).
 */
export async function promoteResultToRole(input: {
  candidateId: string;
  roleAtomId: string;
  resolvedType: string;
}): Promise<{ atomId: string; linkId: string }> {
  const { data, error } = await supabase.rpc("cv_review_promote_result", {
    p_candidate_id: input.candidateId,
    p_role_atom_id: input.roleAtomId,
    p_resolved_type: input.resolvedType,
  });
  if (error) throw error;
  const res = data as { atom_id?: string; link_id?: string } | null;
  if (!res?.atom_id) throw new Error("Kunne ikke bekrefte resultatet.");
  return { atomId: res.atom_id, linkId: res.link_id ?? "" };
}
