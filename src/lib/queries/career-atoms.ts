import { queryOptions, type QueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { buildUserAtomRefreshPlan } from "@/lib/career-atom-refresh";
import type { PlannedEvidenceAtom, PlannedPreferenceAtom } from "@/lib/career-atom-refresh";

export type UserPreferenceAtomRow = Tables<"user_preference_atoms">;
export type UserEvidenceAtomRow = Tables<"user_evidence_atoms">;

export const userPreferenceAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["user-preference-atoms", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<UserPreferenceAtomRow[]> => {
      const { data, error } = await supabase
        .from("user_preference_atoms")
        .select("*")
        .eq("user_id", userId)
        .order("dimension", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UserPreferenceAtomRow[];
    },
  });

export const userEvidenceAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["user-evidence-atoms", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<UserEvidenceAtomRow[]> => {
      const { data, error } = await supabase
        .from("user_evidence_atoms")
        .select("*")
        .eq("user_id", userId)
        .order("category", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UserEvidenceAtomRow[];
    },
  });

export async function upsertPreferenceAtom(
  userId: string,
  payload: Omit<TablesInsert<"user_preference_atoms">, "user_id" | "id"> & {
    id?: string;
    user_id?: string;
  },
): Promise<UserPreferenceAtomRow> {
  const source = payload.source ?? "manual";
  if (payload.id) {
    const patch: TablesUpdate<"user_preference_atoms"> = {
      career_profile_id: payload.career_profile_id,
      dimension: payload.dimension,
      label: payload.label,
      value: payload.value,
      importance_score: payload.importance_score,
      confidence_score: payload.confidence_score,
      source,
      source_field: payload.source_field,
      source_hash: payload.source_hash,
      refreshed_at: payload.refreshed_at,
      stale_at: payload.stale_at,
      reasoning: payload.reasoning,
      is_active: payload.is_active ?? true,
    };
    const { data, error } = await supabase
      .from("user_preference_atoms")
      .update(patch)
      .eq("id", payload.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return data as UserPreferenceAtomRow;
  }
  const insert: TablesInsert<"user_preference_atoms"> = {
    user_id: userId,
    career_profile_id: payload.career_profile_id ?? null,
    dimension: payload.dimension,
    label: payload.label,
    value: payload.value ?? null,
    importance_score: payload.importance_score ?? null,
    confidence_score: payload.confidence_score ?? null,
    source,
    source_field: payload.source_field ?? null,
    source_hash: payload.source_hash ?? null,
    refreshed_at: payload.refreshed_at ?? null,
    stale_at: payload.stale_at ?? null,
    reasoning: payload.reasoning ?? null,
    is_active: payload.is_active ?? true,
  };
  const { data, error } = await supabase
    .from("user_preference_atoms")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferenceAtomRow;
}

export async function upsertEvidenceAtom(
  userId: string,
  payload: Omit<TablesInsert<"user_evidence_atoms">, "user_id" | "id"> & {
    id?: string;
    user_id?: string;
  },
): Promise<UserEvidenceAtomRow> {
  const source = payload.source ?? "manual";
  if (payload.id) {
    const patch: TablesUpdate<"user_evidence_atoms"> = {
      category: payload.category,
      label: payload.label,
      description: payload.description,
      evidence_type: payload.evidence_type,
      source,
      source_document_id: payload.source_document_id,
      source_profile_field: payload.source_profile_field,
      source_url: payload.source_url,
      source_hash: payload.source_hash,
      refreshed_at: payload.refreshed_at,
      stale_at: payload.stale_at,
      strength_score: payload.strength_score,
      confidence_score: payload.confidence_score,
      reasoning: payload.reasoning,
      is_active: payload.is_active ?? true,
    };
    const { data, error } = await supabase
      .from("user_evidence_atoms")
      .update(patch)
      .eq("id", payload.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return data as UserEvidenceAtomRow;
  }
  const insert: TablesInsert<"user_evidence_atoms"> = {
    user_id: userId,
    category: payload.category,
    label: payload.label,
    description: payload.description ?? null,
    evidence_type: payload.evidence_type ?? null,
    source,
    source_document_id: payload.source_document_id ?? null,
    source_profile_field: payload.source_profile_field ?? null,
    source_url: payload.source_url ?? null,
    source_hash: payload.source_hash ?? null,
    refreshed_at: payload.refreshed_at ?? null,
    stale_at: payload.stale_at ?? null,
    strength_score: payload.strength_score ?? null,
    confidence_score: payload.confidence_score ?? null,
    reasoning: payload.reasoning ?? null,
    is_active: payload.is_active ?? true,
  };
  const { data, error } = await supabase
    .from("user_evidence_atoms")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;
  return data as UserEvidenceAtomRow;
}

export async function deactivatePreferenceAtom(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("user_preference_atoms")
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deactivateEvidenceAtom(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("user_evidence_atoms")
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export type RefreshUserAtomsResult = {
  preferenceUpserted: number;
  evidenceUpserted: number;
  deactivated: number;
  warnings: string[];
  summary: string;
};

export function invalidateUserAtomQueries(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: ["user-preference-atoms", userId] });
  void queryClient.invalidateQueries({ queryKey: ["user-evidence-atoms", userId] });
  void queryClient.invalidateQueries({ queryKey: ["user-career-profile", userId] });
}

function isoNow(): string {
  return new Date().toISOString();
}

async function applyPlannedPreferenceAtom(userId: string, p: PlannedPreferenceAtom): Promise<void> {
  const now = isoNow();
  if (p.existingId) {
    const body: TablesUpdate<"user_preference_atoms"> = {
      dimension: p.dimension,
      label: p.label,
      value: p.value,
      importance_score: p.importance_score,
      confidence_score: p.confidence_score ?? 1,
      source: p.source,
      source_field: p.source_field,
      reasoning: p.reasoning,
      career_profile_id: p.career_profile_id,
      source_hash: p.source_hash,
      refreshed_at: now,
      stale_at: null,
      is_active: true,
    };
    const { error } = await supabase
      .from("user_preference_atoms")
      .update(body)
      .eq("id", p.existingId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const insert: TablesInsert<"user_preference_atoms"> = {
    user_id: userId,
    career_profile_id: p.career_profile_id,
    dimension: p.dimension,
    label: p.label,
    value: p.value,
    importance_score: p.importance_score,
    confidence_score: p.confidence_score ?? 1,
    source: p.source,
    source_field: p.source_field,
    reasoning: p.reasoning,
    source_hash: p.source_hash,
    refreshed_at: now,
    stale_at: null,
    is_active: true,
  };
  const { error } = await supabase.from("user_preference_atoms").insert(insert);
  if (error) throw error;
}

async function applyPlannedEvidenceAtom(userId: string, e: PlannedEvidenceAtom): Promise<void> {
  const now = isoNow();
  if (e.existingId) {
    const body: TablesUpdate<"user_evidence_atoms"> = {
      category: e.category,
      label: e.label,
      description: e.description,
      evidence_type: e.evidence_type,
      source: e.source,
      source_document_id: e.source_document_id,
      source_profile_field: e.source_profile_field,
      source_hash: e.source_hash,
      refreshed_at: now,
      stale_at: null,
      strength_score: e.strength_score,
      confidence_score: e.confidence_score ?? 1,
      reasoning: e.reasoning,
      is_active: true,
    };
    const { error } = await supabase
      .from("user_evidence_atoms")
      .update(body)
      .eq("id", e.existingId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const insert: TablesInsert<"user_evidence_atoms"> = {
    user_id: userId,
    category: e.category,
    label: e.label,
    description: e.description,
    evidence_type: e.evidence_type,
    source: e.source,
    source_document_id: e.source_document_id,
    source_profile_field: e.source_profile_field,
    source_url: null,
    source_hash: e.source_hash,
    refreshed_at: now,
    stale_at: null,
    strength_score: e.strength_score,
    confidence_score: e.confidence_score ?? 1,
    reasoning: e.reasoning,
    is_active: true,
  };
  const { error } = await supabase.from("user_evidence_atoms").insert(insert);
  if (error) throw error;
}

/**
 * Deterministically refresh system-managed atoms from karriereprofil, profil, dokumenter, CV-import, LinkedIn-felter og vurderinger.
 * Manual atoms (source = manual) are never updated or deleted.
 */
export async function refreshUserAtoms(userId: string): Promise<RefreshUserAtomsResult> {
  const warnings: string[] = [];
  const pushWarn = (scope: string, err: { message?: string } | null) => {
    if (err?.message) warnings.push(`${scope}: ${err.message}`);
  };

  const { data: careerProfile, error: cErr } = await supabase
    .from("user_career_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  pushWarn("user_career_profiles", cErr);

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  pushWarn("profiles", pErr);

  let documents: Tables<"documents">[] = [];
  const { data: docData, error: dErr } = await supabase
    .from("documents")
    .select("id, title, document_type, deleted_at")
    .eq("user_id", userId)
    .is("deleted_at", null);
  pushWarn("documents", dErr);
  documents = (docData ?? []) as Tables<"documents">[];

  let cvImports: Tables<"cv_imports">[] = [];
  const { data: cvData, error: cvErr } = await supabase
    .from("cv_imports")
    .select("id, status, source_filename")
    .eq("user_id", userId);
  pushWarn("cv_imports", cvErr);
  cvImports = (cvData ?? []) as Tables<"cv_imports">[];

  let ratings: Pick<
    Tables<"user_company_ratings">,
    "id" | "overall_score" | "user_notes" | "user_id"
  >[] = [];
  const { data: rData, error: rErr } = await supabase
    .from("user_company_ratings")
    .select("id, overall_score, user_notes, user_id")
    .eq("user_id", userId);
  pushWarn("user_company_ratings", rErr);
  ratings = (rData ?? []) as Pick<
    Tables<"user_company_ratings">,
    "id" | "overall_score" | "user_notes" | "user_id"
  >[];

  let cvEvidenceAtomCount = 0;
  const { count: cvEvCount, error: cvEvErr } = await supabase
    .from("cv_evidence_atoms")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  pushWarn("cv_evidence_atoms", cvEvErr);
  cvEvidenceAtomCount = cvEvCount ?? 0;

  const { data: existingPrefs, error: epErr } = await supabase
    .from("user_preference_atoms")
    .select("*")
    .eq("user_id", userId);
  pushWarn("user_preference_atoms (les)", epErr);
  const { data: existingEv, error: eeErr } = await supabase
    .from("user_evidence_atoms")
    .select("*")
    .eq("user_id", userId);
  pushWarn("user_evidence_atoms (les)", eeErr);

  const plan = buildUserAtomRefreshPlan({
    careerProfile: (careerProfile ?? null) as Tables<"user_career_profiles"> | null,
    profile: (profile ?? null) as Tables<"profiles"> | null,
    documents,
    cvImports,
    cvEvidenceAtomCount,
    userCompanyRatings: ratings,
    existingPreferenceAtoms: (existingPrefs ?? []) as Tables<"user_preference_atoms">[],
    existingEvidenceAtoms: (existingEv ?? []) as Tables<"user_evidence_atoms">[],
  });

  for (const w of plan.warnings) warnings.push(w);

  let preferenceUpserted = 0;
  for (const row of plan.preferenceAtomsToUpsert) {
    await applyPlannedPreferenceAtom(userId, row);
    preferenceUpserted++;
  }

  let evidenceUpserted = 0;
  for (const row of plan.evidenceAtomsToUpsert) {
    await applyPlannedEvidenceAtom(userId, row);
    evidenceUpserted++;
  }

  const now = isoNow();
  const refreshedIds = new Set<string>([
    ...(plan.preferenceAtomsToUpsert.map((p) => p.existingId).filter(Boolean) as string[]),
    ...(plan.evidenceAtomsToUpsert.map((e) => e.existingId).filter(Boolean) as string[]),
  ]);
  let deactivated = 0;
  for (const t of plan.systemAtomsToDeactivate) {
    if (refreshedIds.has(t.id)) continue;
    if (t.kind === "preference") {
      const { error } = await supabase
        .from("user_preference_atoms")
        .update({ is_active: false, stale_at: now, refreshed_at: now })
        .eq("id", t.id)
        .eq("user_id", userId);
      if (error) throw error;
      deactivated++;
    } else {
      const { error } = await supabase
        .from("user_evidence_atoms")
        .update({ is_active: false, stale_at: now, refreshed_at: now })
        .eq("id", t.id)
        .eq("user_id", userId);
      if (error) throw error;
      deactivated++;
    }
  }

  return {
    preferenceUpserted,
    evidenceUpserted,
    deactivated,
    warnings,
    summary: plan.summary,
  };
}

/** Options for `useMutation` — pass `useQueryClient()` as the second argument. */
export function refreshUserAtomsMutation(
  userId: string,
  queryClient: QueryClient,
): Pick<UseMutationOptions<RefreshUserAtomsResult, Error, void>, "mutationFn" | "onSuccess"> {
  return {
    mutationFn: () => refreshUserAtoms(userId),
    onSuccess: () => invalidateUserAtomQueries(queryClient, userId),
  };
}
