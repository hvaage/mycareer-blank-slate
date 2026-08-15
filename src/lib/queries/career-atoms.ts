/**
 * Karriereontologi v4 — CRUD og ferskhetsmekanikk mot `career_atoms`.
 * De gamle tabellene `user_preference_atoms` og `user_evidence_atoms` leses ikke lenger.
 */
import { queryOptions, type QueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  buildUserAtomRefreshPlan,
  careerAtomLogicalKey,
  computeStaleAt,
  defaultValidToForBegrensning,
  evidenceAgeYears,
  freshnessFor,
  type FreshnessView,
  type PlannedEvidenceAtom,
  type PlannedPreferenceAtom,
} from "@/lib/career-atom-refresh";
import {
  evidenceAtomTypeFor,
  findEvidencePointersForSkill,
  INDIRECT_ATOM_TYPES,
  bareTermFromLabel,
} from "@/lib/career-atom-v4-mapping";

export type CareerAtomRow = Tables<"career_atoms">;

/** Presentasjonsform for preferansesiden (ønske/verdi/begrensning/mål/mangel). */
export type UserPreferenceAtomRow = {
  id: string;
  is_active: boolean;
  atom_kind: string;
  dimension: string;
  label: string;
  value: string | null;
  importance_score: number | null;
  source: string;
  created_at: string;
  freshness: FreshnessView;
  raw: CareerAtomRow;
};

/** Presentasjonsform for evidenssiden. */
export type UserEvidenceAtomRow = {
  id: string;
  is_active: boolean;
  category: string;
  label: string;
  description: string | null;
  strength_score: number | null;
  source: string;
  created_at: string;
  ageYears: number | null;
  sourceMissing: boolean;
  evidenceAtomIds: string[];
  raw: CareerAtomRow;
};

const PREF_KINDS = ["onske", "verdi", "begrensning", "maal", "mangel"];

function sd(row: CareerAtomRow): Record<string, unknown> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function toPreferenceView(row: CareerAtomRow): UserPreferenceAtomRow {
  const s = sd(row);
  return {
    id: row.id,
    is_active: row.is_active,
    atom_kind: row.atom_kind,
    dimension: str(s["dimensjon"]) ?? str(s["dimension"]) ?? row.atom_kind,
    label: str(s["etikett"]) ?? row.content_no ?? "",
    value: str(s["verdi"]) ?? null,
    importance_score: row.viktighet,
    source: row.source_type,
    created_at: row.created_at,
    freshness: freshnessFor(row),
    raw: row,
  };
}

export function toEvidenceView(row: CareerAtomRow): UserEvidenceAtomRow {
  const s = sd(row);
  return {
    id: row.id,
    is_active: row.is_active,
    category: row.atom_type ?? str(s["kategori"]) ?? "annet",
    label: str(s["etikett"]) ?? row.content_no ?? "",
    description: str(s["beskrivelse"]) ?? row.source_quote,
    strength_score: row.viktighet,
    source: row.source_type,
    created_at: row.created_at,
    ageYears: evidenceAgeYears(row),
    sourceMissing: s["source_missing"] === true,
    evidenceAtomIds: (row.evidence_atom_ids ?? []) as string[],
    raw: row,
  };
}

async function fetchCareerAtoms(userId: string): Promise<CareerAtomRow[]> {
  const { data, error } = await supabase
    .from("career_atoms")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CareerAtomRow[];
}

export const careerAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["career-atoms", userId],
    staleTime: 30_000,
    queryFn: () => fetchCareerAtoms(userId),
  });

export const userPreferenceAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["user-preference-atoms", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<UserPreferenceAtomRow[]> =>
      (await fetchCareerAtoms(userId))
        .filter((r) => PREF_KINDS.includes(r.atom_kind))
        .map(toPreferenceView),
  });

export const userEvidenceAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["user-evidence-atoms", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<UserEvidenceAtomRow[]> =>
      (await fetchCareerAtoms(userId))
        .filter((r) => r.atom_kind === "evidens")
        .map(toEvidenceView),
  });

function clamp6(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.min(6, Math.max(1, Math.round(Number(n))));
}

// ---------------------------------------------------------------------------
// Skriving
// ---------------------------------------------------------------------------

export type UpsertPreferencePayload = {
  id?: string;
  atom_kind?: "onske" | "verdi" | "begrensning";
  dimension: string;
  label: string;
  value?: string | null;
  importance_score?: number | null;
  source?: string;
  source_field?: string | null;
  career_profile_id?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
};

export async function upsertPreferenceAtom(
  userId: string,
  payload: UpsertPreferencePayload,
): Promise<CareerAtomRow> {
  const kind = payload.atom_kind ?? "onske";
  const now = new Date().toISOString();
  const label = payload.label.trim();
  const value = payload.value?.trim() || null;
  // Begrensninger får alltid en sluttdato, slik at den årlige påminnelsen utløses.
  const validTo =
    kind === "begrensning" ? (payload.valid_to ?? defaultValidToForBegrensning()) : null;
  const structured: Record<string, unknown> = {
    dimensjon: payload.dimension,
    etikett: label,
    verdi: value,
    career_profile_id: payload.career_profile_id ?? null,
    source_field: payload.source_field ?? null,
  };
  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: kind,
    content_no: label,
    structured_data: structured,
  });

  const common = {
    atom_kind: kind,
    atom_type: null,
    content_no: value && value !== label ? `${label}: ${value}` : label,
    structured_data: structured as Json,
    source_type: payload.source ?? "manual",
    source_ref: payload.source_field ?? null,
    viktighet: clamp6(payload.importance_score),
    valid_to: validTo,
    refreshed_at: now,
    stale_at: computeStaleAt(kind, { refreshedAt: now, validTo }),
    is_active: payload.is_active ?? true,
  };

  if (payload.id) {
    const { data, error } = await supabase
      .from("career_atoms")
      .update(common as TablesUpdate<"career_atoms">)
      .eq("id", payload.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return data as CareerAtomRow;
  }
  const { data, error } = await supabase
    .from("career_atoms")
    .insert({ ...common, user_id: userId } as TablesInsert<"career_atoms">)
    .select()
    .single();
  if (error) throw error;
  return data as CareerAtomRow;
}

export type UpsertEvidencePayload = {
  id?: string;
  category: string;
  label: string;
  description?: string | null;
  strength_score?: number | null;
  source?: string;
  source_field?: string | null;
  source_document_id?: string | null;
  evidence_atom_ids?: string[];
  parent_atom_id?: string | null;
  is_active?: boolean;
};

export async function upsertEvidenceAtom(
  userId: string,
  payload: UpsertEvidencePayload,
): Promise<CareerAtomRow> {
  const atomType = evidenceAtomTypeFor(payload.category);
  if (!atomType) {
    throw new Error(
      `Ukjent evidenskategori «${payload.category}». Velg en kategori som finnes i karriereontologi v4.`,
    );
  }
  const label = payload.label.trim();
  let pointers = payload.evidence_atom_ids ?? [];
  let parent = payload.parent_atom_id ?? null;

  if (INDIRECT_ATOM_TYPES.has(atomType) && pointers.length === 0) {
    const existing = (await fetchCareerAtoms(userId)).filter(
      (r) => r.is_active && r.atom_kind === "evidens",
    );
    if (atomType === "skill") {
      pointers = findEvidencePointersForSkill(
        bareTermFromLabel(label),
        existing.map((r) => ({
          id: r.id,
          atom_class: r.atom_class,
          atom_type: r.atom_type,
          content_no: r.content_no,
        })),
      );
    } else {
      const role = existing.find((r) => r.atom_type === "role");
      parent = role?.id ?? null;
      pointers = role ? [role.id] : [];
    }
    if (pointers.length === 0) {
      throw new Error(
        atomType === "skill"
          ? `«${label}» er en kompetanse og kan bare belegges indirekte. Legg først inn en rolle, utdanning eller et resultat som viser hvor du har brukt den.`
          : `«${label}» er eksponering og må knyttes til en rolle. Legg inn rollen først.`,
      );
    }
  }

  const now = new Date().toISOString();
  const structured: Record<string, unknown> = {
    kategori: payload.category,
    etikett: label,
    beskrivelse: payload.description?.trim() || null,
    source_field: payload.source_field ?? null,
    source_document_id: payload.source_document_id ?? null,
  };
  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: "evidens",
    atom_type: atomType,
    content_no: label,
    structured_data: structured,
  });

  const common = {
    atom_kind: "evidens",
    atom_type: atomType,
    parent_atom_id: parent,
    content_no: label,
    structured_data: structured as Json,
    source_type: payload.source ?? "manual",
    source_ref: payload.source_field ?? null,
    source_quote: payload.description?.trim() || null,
    evidence_atom_ids: pointers,
    viktighet: clamp6(payload.strength_score),
    refreshed_at: now,
    // Evidens forfaller aldri.
    stale_at: null,
    is_active: payload.is_active ?? true,
  };

  if (payload.id) {
    const { data, error } = await supabase
      .from("career_atoms")
      .update(common as TablesUpdate<"career_atoms">)
      .eq("id", payload.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return data as CareerAtomRow;
  }
  const { data, error } = await supabase
    .from("career_atoms")
    .insert({ ...common, user_id: userId } as TablesInsert<"career_atoms">)
    .select()
    .single();
  if (error) throw error;
  return data as CareerAtomRow;
}

async function deactivateAtom(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("career_atoms")
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export const deactivatePreferenceAtom = deactivateAtom;
export const deactivateEvidenceAtom = deactivateAtom;

/** Brukerbekreftelse: nullstiller ferskheten uten å endre innholdet. */
export async function confirmAtomStillValid(userId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("career_atoms")
    .select("atom_kind, due_at, valid_to")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const now = new Date().toISOString();
  const validTo =
    data.atom_kind === "begrensning"
      ? defaultValidToForBegrensning()
      : ((data.valid_to as string | null) ?? null);
  const { error: uErr } = await supabase
    .from("career_atoms")
    .update({
      refreshed_at: now,
      user_confirmed: true,
      is_active: true,
      valid_to: validTo,
      stale_at: computeStaleAt(data.atom_kind, {
        refreshedAt: now,
        dueAt: data.due_at as string | null,
        validTo,
      }),
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (uErr) throw uErr;
}

export type RefreshUserAtomsResult = {
  preferenceUpserted: number;
  evidenceUpserted: number;
  deactivated: number;
  evidenceSourceMissing: number;
  warnings: string[];
  summary: string;
};

export function invalidateUserAtomQueries(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: ["career-atoms", userId] });
  void queryClient.invalidateQueries({ queryKey: ["user-preference-atoms", userId] });
  void queryClient.invalidateQueries({ queryKey: ["user-evidence-atoms", userId] });
  void queryClient.invalidateQueries({ queryKey: ["user-career-profile", userId] });
}

function isoNow(): string {
  return new Date().toISOString();
}

async function applyPlannedPreferenceAtom(userId: string, p: PlannedPreferenceAtom): Promise<void> {
  const now = isoNow();
  const structured: Record<string, unknown> = {
    dimensjon: p.dimension,
    etikett: p.label,
    verdi: p.value,
    logical_key: p.logicalKey,
    source_field: p.source_field,
    source_hash: p.source_hash,
    career_profile_id: p.career_profile_id,
  };
  const body = {
    atom_kind: "onske",
    atom_type: null,
    content_no: p.value && p.value !== p.label ? `${p.label}: ${p.value}` : p.label,
    structured_data: structured as Json,
    source_type: p.source,
    source_ref: p.source_field,
    source_quote: p.value,
    viktighet: p.importance_score,
    refreshed_at: now,
    stale_at: computeStaleAt("onske", { refreshedAt: now }),
    is_active: true,
  };
  if (p.existingId) {
    const { error } = await supabase
      .from("career_atoms")
      .update(body as TablesUpdate<"career_atoms">)
      .eq("id", p.existingId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("career_atoms")
    .insert({ ...body, user_id: userId } as TablesInsert<"career_atoms">);
  if (error) throw error;
}

async function applyPlannedEvidenceAtom(
  userId: string,
  e: PlannedEvidenceAtom,
  pointerLookup: { id: string; atom_class: string | null; atom_type: string | null; content_no: string | null }[],
): Promise<"written" | "skipped_no_pointers" | "skipped_unknown_type"> {
  const atomType = evidenceAtomTypeFor(e.category);
  if (!atomType) return "skipped_unknown_type";
  let pointers: string[] = [];
  let parent: string | null = null;
  if (atomType === "skill") {
    pointers = findEvidencePointersForSkill(bareTermFromLabel(e.label), pointerLookup);
  } else if (atomType === "domain") {
    const role = pointerLookup.find((r) => r.atom_type === "role");
    parent = role?.id ?? null;
    pointers = role ? [role.id] : [];
  }
  if (INDIRECT_ATOM_TYPES.has(atomType) && pointers.length === 0) return "skipped_no_pointers";

  const now = isoNow();
  const structured: Record<string, unknown> = {
    kategori: e.category,
    etikett: e.label,
    beskrivelse: e.description,
    logical_key: e.logicalKey,
    source_field: e.source_field,
    source_hash: e.source_hash,
    source_document_id: e.source_document_id,
    source_profile_field: e.source_profile_field,
    evidence_type: e.evidence_type,
  };
  const body = {
    atom_kind: "evidens",
    atom_type: atomType,
    parent_atom_id: parent,
    content_no: e.label,
    structured_data: structured as Json,
    source_type: e.source,
    source_ref: e.source_field,
    source_quote: e.description,
    evidence_atom_ids: pointers,
    viktighet: e.strength_score,
    refreshed_at: now,
    stale_at: null,
    is_active: true,
  };
  if (e.existingId) {
    const { error } = await supabase
      .from("career_atoms")
      .update(body as TablesUpdate<"career_atoms">)
      .eq("id", e.existingId)
      .eq("user_id", userId);
    if (error) throw error;
    return "written";
  }
  const { error } = await supabase
    .from("career_atoms")
    .insert({ ...body, user_id: userId } as TablesInsert<"career_atoms">);
  if (error) throw error;
  return "written";
}

/**
 * Deterministisk oppdatering av systemstyrte atomer fra karriereprofil, profil,
 * dokumenter, CV-import, LinkedIn-felter og arbeidsgivervurderinger.
 * Manuelle atomer (source_type = manual) endres aldri.
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
  pushWarn("Karriereprofil", cErr);

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  pushWarn("Profil", pErr);

  const { data: docData, error: dErr } = await supabase
    .from("documents")
    .select("id, title, document_type, deleted_at")
    .eq("user_id", userId)
    .is("deleted_at", null);
  pushWarn("Dokumenter", dErr);

  const { data: cvData, error: cvErr } = await supabase
    .from("cv_imports")
    .select("id, status, source_filename")
    .eq("user_id", userId);
  pushWarn("CV-import", cvErr);

  const { data: rData, error: rErr } = await supabase
    .from("user_company_ratings")
    .select("id, overall_score, user_notes")
    .eq("user_id", userId);
  pushWarn("Arbeidsgivervurderinger", rErr);

  const { count: cvEvCount, error: cvEvErr } = await supabase
    .from("cv_evidence_atoms")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  pushWarn("CV-evidens", cvEvErr);

  const existingAtoms = await fetchCareerAtoms(userId);

  const plan = buildUserAtomRefreshPlan({
    careerProfile: (careerProfile ?? null) as Tables<"user_career_profiles"> | null,
    profile: (profile ?? null) as Tables<"profiles"> | null,
    documents: (docData ?? []) as never,
    cvImports: (cvData ?? []) as never,
    cvEvidenceAtomCount: cvEvCount ?? 0,
    userCompanyRatings: (rData ?? []) as never,
    existingAtoms,
  });

  for (const w of plan.warnings) warnings.push(w);

  let preferenceUpserted = 0;
  for (const row of plan.preferenceAtomsToUpsert) {
    await applyPlannedPreferenceAtom(userId, row);
    preferenceUpserted++;
  }

  const pointerLookup = existingAtoms
    .filter((r) => r.is_active && r.atom_kind === "evidens")
    .map((r) => ({
      id: r.id,
      atom_class: r.atom_class,
      atom_type: r.atom_type,
      content_no: r.content_no,
    }));

  let evidenceUpserted = 0;
  let skippedNoPointers = 0;
  for (const row of plan.evidenceAtomsToUpsert) {
    const res = await applyPlannedEvidenceAtom(userId, row, pointerLookup);
    if (res === "written") evidenceUpserted++;
    else if (res === "skipped_no_pointers") skippedNoPointers++;
  }
  if (skippedNoPointers > 0) {
    warnings.push(
      `${skippedNoPointers} kompetanse/eksponering ble ikke lagret fordi de mangler belegg. De kommer som spørsmål i forslagslisten.`,
    );
  }

  const refreshedIds = new Set<string>([
    ...(plan.preferenceAtomsToUpsert.map((p) => p.existingId).filter(Boolean) as string[]),
    ...(plan.evidenceAtomsToUpsert.map((e) => e.existingId).filter(Boolean) as string[]),
  ]);

  let deactivated = 0;
  for (const t of plan.systemAtomsToDeactivate) {
    if (refreshedIds.has(t.id)) continue;
    const { error } = await supabase
      .from("career_atoms")
      .update({ is_active: false, refreshed_at: isoNow() })
      .eq("id", t.id)
      .eq("user_id", userId);
    if (error) throw error;
    deactivated++;
  }

  // Evidens uten kilde beholdes aktiv, men merkes i structured_data.
  let evidenceSourceMissing = 0;
  for (const t of plan.evidenceMissingFromSource) {
    const row = existingAtoms.find((r) => r.id === t.id);
    if (!row) continue;
    const structured = { ...sd(row), source_missing: true };
    const { error } = await supabase
      .from("career_atoms")
      .update({ structured_data: structured as Json })
      .eq("id", t.id)
      .eq("user_id", userId);
    if (error) throw error;
    evidenceSourceMissing++;
  }

  return {
    preferenceUpserted,
    evidenceUpserted,
    deactivated,
    evidenceSourceMissing,
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
