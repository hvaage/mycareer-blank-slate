import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type AtomEnrichmentBatchRow = Tables<"atom_enrichment_batches">;
export type AtomEnrichmentProposalRow = Tables<"atom_enrichment_proposals">;

export type AtomEnrichmentProposalAction =
  Database["public"]["Enums"]["atom_enrichment_proposal_action"];
export type AtomEnrichmentProposalStatus =
  Database["public"]["Enums"]["atom_enrichment_proposal_status"];

export const ATOM_ENRICHMENT_PROPOSAL_ACTION_LABELS: Record<AtomEnrichmentProposalAction, string> =
  {
    create_atom: "Opprett atom",
    update_atom: "Oppdater atom",
    merge_atoms: "Slå sammen atomer",
    deactivate_atom: "Deaktiver atom",
    flag_conflict: "Flagg konflikt",
    suggest_positioning: "Foreslå posisjonering",
    suggest_narrative: "Foreslå fortelling",
    suggest_evidence: "Foreslå evidens",
    suggest_preference_clarification: "Foreslå avklaring av preferanse",
  };

export const ATOM_ENRICHMENT_PROPOSAL_STATUS_LABELS: Record<AtomEnrichmentProposalStatus, string> =
  {
    pending_review: "Venter på vurdering",
    approved: "Godkjent",
    rejected: "Avvist",
    merged: "Flettet",
    needs_more_context: "Trenger mer kontekst",
    superseded: "Erstattet",
    expired: "Utløpt",
  };

export const TARGET_ATOM_TYPE_LABELS: Record<string, string> = {
  user_preference_atom: "Preferanseatom",
  user_evidence_atom: "Evidensatom",
  opportunity_requirement_atom: "Stillingskrav-atom",
  company_profile_atom: "Selskapsprofil-atom",
  company_signal_atom: "Selskapssignal-atom",
};

/** Approving these actions records acceptance in gjennomgangen only — no rows in atom-tabeller. */
const APPROVAL_WITHOUT_ATOM_WRITE: ReadonlySet<AtomEnrichmentProposalAction> = new Set([
  "suggest_evidence",
  "suggest_preference_clarification",
  "flag_conflict",
  "suggest_positioning",
  "suggest_narrative",
  "merge_atoms",
]);

export function proposalApprovalWritesAtoms(row: AtomEnrichmentProposalRow): boolean {
  return !APPROVAL_WITHOUT_ATOM_WRITE.has(row.proposal_action);
}

export function invalidateAtomEnrichmentQueries(qc: QueryClient, userId: string): void {
  void qc.invalidateQueries({ queryKey: ["atom-enrichment-batches", userId] });
  void qc.invalidateQueries({ queryKey: ["atom-enrichment-proposals", userId] });
}

export const atomEnrichmentBatchesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-batches", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async (): Promise<AtomEnrichmentBatchRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_batches")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentBatchRow[];
    },
  });

export const pendingAtomEnrichmentProposalsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "pending"],
    enabled: !!userId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending_review")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

export const atomEnrichmentProposalsByStatusQuery = (
  userId: string,
  status: AtomEnrichmentProposalStatus,
) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "status", status],
    enabled: !!userId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

export const atomEnrichmentProposalsByBatchQuery = (userId: string, batchId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "batch", batchId],
    enabled: !!userId && !!batchId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

function asRecord(payload: Json | null | undefined): Record<string, unknown> {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function strField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function assertManualSafePreference(userId: string, atomId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_preference_atoms")
    .select("id, source")
    .eq("id", atomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke preferanse-atomet.");
  if (data.source === "manual") {
    throw new Error(
      "Kan ikke endre manuelle preferanser via AI-forslag. Rediger selv under Karriereprofil.",
    );
  }
}

async function assertManualSafeEvidence(userId: string, atomId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_evidence_atoms")
    .select("id, source")
    .eq("id", atomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke evidens-atomet.");
  if (data.source === "manual") {
    throw new Error(
      "Kan ikke endre manuelle evidens-atomer via AI-forslag. Rediger selv under Karriereprofil.",
    );
  }
}

/**
 * Applies an approved proposal to user-owned atoms only.
 * Target-side atoms stay schema-ready; application is deferred (review-only in UI).
 */
async function applyApprovedUserAtomProposal(
  userId: string,
  row: AtomEnrichmentProposalRow,
): Promise<void> {
  const payload = asRecord(row.proposal_payload);
  const action = row.proposal_action;

  if (row.target_atom_type === "user_preference_atom") {
    if (action === "create_atom") {
      const dimension = strField(payload, "dimension");
      const label = strField(payload, "label");
      if (!dimension?.trim() || !label?.trim()) {
        throw new Error("Forslaget mangler dimension eller label for preferanse-atom.");
      }
      const insert: TablesInsert<"user_preference_atoms"> = {
        user_id: userId,
        career_profile_id: strField(payload, "career_profile_id"),
        dimension: dimension.trim(),
        label: label.trim(),
        value: strField(payload, "value"),
        importance_score: numField(payload, "importance_score") as number | null,
        confidence_score: row.confidence ?? numField(payload, "confidence_score"),
        source: strField(payload, "source")?.trim() || "enrichment",
        source_field: strField(payload, "source_field"),
        source_hash: strField(payload, "source_hash") ?? row.source_hash,
        reasoning: strField(payload, "reasoning") ?? row.rationale,
        is_active: payload.is_active !== false,
      };
      const { error } = await supabase.from("user_preference_atoms").insert(insert);
      if (error) throw error;
      return;
    }
    if (action === "update_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for oppdatering.");
      await assertManualSafePreference(userId, tid);
      const patch: TablesUpdate<"user_preference_atoms"> = {
        career_profile_id: strField(payload, "career_profile_id") ?? undefined,
        dimension: strField(payload, "dimension")?.trim() ?? undefined,
        label: strField(payload, "label")?.trim() ?? undefined,
        value: strField(payload, "value"),
        importance_score: numField(payload, "importance_score") as number | null | undefined,
        confidence_score: row.confidence ?? numField(payload, "confidence_score") ?? undefined,
        source: strField(payload, "source")?.trim() ?? undefined,
        source_field: strField(payload, "source_field") ?? undefined,
        source_hash: strField(payload, "source_hash") ?? row.source_hash ?? undefined,
        reasoning: strField(payload, "reasoning") ?? row.rationale ?? undefined,
        is_active: typeof payload.is_active === "boolean" ? payload.is_active : undefined,
      };
      const { error } = await supabase
        .from("user_preference_atoms")
        .update(patch)
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
    if (action === "deactivate_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for deaktivering.");
      await assertManualSafePreference(userId, tid);
      const { error } = await supabase
        .from("user_preference_atoms")
        .update({ is_active: false })
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
  }

  if (row.target_atom_type === "user_evidence_atom") {
    if (action === "create_atom") {
      const category = strField(payload, "category");
      const label = strField(payload, "label");
      if (!category?.trim() || !label?.trim()) {
        throw new Error("Forslaget mangler category eller label for evidens-atom.");
      }
      const insert: TablesInsert<"user_evidence_atoms"> = {
        user_id: userId,
        category: category.trim(),
        label: label.trim(),
        description: strField(payload, "description"),
        evidence_type: strField(payload, "evidence_type"),
        source: strField(payload, "source")?.trim() || "enrichment",
        source_document_id: strField(payload, "source_document_id"),
        source_profile_field: strField(payload, "source_profile_field"),
        source_url: strField(payload, "source_url"),
        source_hash: strField(payload, "source_hash") ?? row.source_hash,
        strength_score: numField(payload, "strength_score") as number | null,
        confidence_score: row.confidence ?? numField(payload, "confidence_score"),
        reasoning: strField(payload, "reasoning") ?? row.rationale,
        is_active: payload.is_active !== false,
      };
      const { error } = await supabase.from("user_evidence_atoms").insert(insert);
      if (error) throw error;
      return;
    }
    if (action === "update_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for oppdatering.");
      await assertManualSafeEvidence(userId, tid);
      const patch: TablesUpdate<"user_evidence_atoms"> = {
        category: strField(payload, "category")?.trim() ?? undefined,
        label: strField(payload, "label")?.trim() ?? undefined,
        description: strField(payload, "description"),
        evidence_type: strField(payload, "evidence_type") ?? undefined,
        source: strField(payload, "source")?.trim() ?? undefined,
        source_document_id: strField(payload, "source_document_id") ?? undefined,
        source_profile_field: strField(payload, "source_profile_field") ?? undefined,
        source_url: strField(payload, "source_url") ?? undefined,
        source_hash: strField(payload, "source_hash") ?? row.source_hash ?? undefined,
        strength_score: numField(payload, "strength_score") as number | null | undefined,
        confidence_score: row.confidence ?? numField(payload, "confidence_score") ?? undefined,
        reasoning: strField(payload, "reasoning") ?? row.rationale ?? undefined,
        is_active: typeof payload.is_active === "boolean" ? payload.is_active : undefined,
      };
      const { error } = await supabase
        .from("user_evidence_atoms")
        .update(patch)
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
    if (action === "deactivate_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for deaktivering.");
      await assertManualSafeEvidence(userId, tid);
      const { error } = await supabase
        .from("user_evidence_atoms")
        .update({ is_active: false })
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
  }

  if (
    row.target_atom_type === "opportunity_requirement_atom" ||
    row.target_atom_type === "company_profile_atom" ||
    row.target_atom_type === "company_signal_atom"
  ) {
    throw new Error(
      "Godkjenning som skriver til stillings- eller selskapsatomer er ikke implementert ennå — visning og avvisning støttes.",
    );
  }

  throw new Error(
    `Godkjenning for handlingen «${ATOM_ENRICHMENT_PROPOSAL_ACTION_LABELS[action] ?? action}» er ikke implementert ennå.`,
  );
}

export async function approveAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  opts?: { reviewerComment?: string },
): Promise<void> {
  const { data: row, error: fetchErr } = await supabase
    .from("atom_enrichment_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error("Fant ikke forslaget.");
  if (row.status !== "pending_review" && row.status !== "needs_more_context") {
    throw new Error("Forslaget er ikke lenger til vurdering.");
  }

  const typed = row as AtomEnrichmentProposalRow;
  if (proposalApprovalWritesAtoms(typed)) {
    await applyApprovedUserAtomProposal(userId, typed);
  }

  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "approved",
      reviewed_at: now,
      reviewed_by: userId,
      reviewer_comment: opts?.reviewerComment?.trim() || null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .in("status", ["pending_review", "needs_more_context"])
    .select("id")
    .maybeSingle();
  if (upErr) throw upErr;
  if (!updated)
    throw new Error("Kunne ikke bekrefte forslaget — det kan ha blitt behandlet av noen andre.");
}

export async function rejectAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  reviewerComment?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "rejected",
      reviewed_at: now,
      reviewed_by: userId,
      reviewer_comment: reviewerComment?.trim() || null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .in("status", ["pending_review", "needs_more_context"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke forslaget, eller det er allerede behandlet.");
}

export async function markAtomEnrichmentProposalNeedsContext(
  userId: string,
  proposalId: string,
  reviewerComment?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "needs_more_context",
      reviewed_at: now,
      reviewed_by: userId,
      reviewer_comment: reviewerComment?.trim() || null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke forslaget, eller det er allerede behandlet.");
}

export async function reopenAtomEnrichmentProposalToPending(
  userId: string,
  proposalId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "pending_review",
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "needs_more_context")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error("Fant ikke forslaget, eller det er ikke merket som «trenger mer kontekst».");
}

export type BulkProposalOutcome = { ok: number; failed: { id: string; message: string }[] };

export async function bulkApproveAtomEnrichmentProposals(
  userId: string,
  proposalIds: string[],
  opts?: { reviewerComment?: string },
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await approveAtomEnrichmentProposal(userId, id, { reviewerComment: opts?.reviewerComment });
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkRejectAtomEnrichmentProposals(
  userId: string,
  proposalIds: string[],
  reviewerComment?: string,
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await rejectAtomEnrichmentProposal(userId, id, reviewerComment);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkMarkAtomEnrichmentProposalsNeedsContext(
  userId: string,
  proposalIds: string[],
  reviewerComment?: string,
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await markAtomEnrichmentProposalNeedsContext(userId, id, reviewerComment);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkReopenAtomEnrichmentProposalsToPending(
  userId: string,
  proposalIds: string[],
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await reopenAtomEnrichmentProposalToPending(userId, id);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function supersedeAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  supersededByProposalId: string,
): Promise<void> {
  const { error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "superseded",
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
      superseded_by_proposal_id: supersededByProposalId,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "pending_review");
  if (error) throw error;
}

/**
 * Lokal utvikling: oppretter én eksempel-batch med ett ventende forslag (preferanse).
 * Kjør kun når migrasjonen er brukt lokalt. Ikke bruk i produksjon.
 */
export async function insertLocalDevSamplePendingProposal(userId: string): Promise<{
  batchId: string;
  proposalId: string;
} | null> {
  if (!import.meta.env.DEV) return null;

  const { data: batch, error: bErr } = await supabase
    .from("atom_enrichment_batches")
    .insert({
      user_id: userId,
      title: "Test — eksempelforslag (kun utvikling)",
      source_type: "dev_seed",
      context: { note: "Slettes trygt etter testing" },
    })
    .select("id")
    .single();
  if (bErr) throw bErr;
  const batchId = batch!.id as string;

  const proposalPayload: Json = {
    dimension: "arbeidsform",
    label: "Hybrid (2–3 dager kontor)",
    value: "Ønsker hovedsakelig hjemmekontor med planlagte kontordager.",
    importance_score: 5,
    source: "enrichment",
  };

  const { data: prop, error: pErr } = await supabase
    .from("atom_enrichment_proposals")
    .insert({
      user_id: userId,
      batch_id: batchId,
      proposal_action: "create_atom",
      target_atom_type: "user_preference_atom",
      source_type: "dev_seed",
      proposal_payload: proposalPayload,
      rationale: "Dette er et kunstig testforslag for utviklere — ikke ekte brukerdata.",
      explanation:
        "I produksjon skal slike testforslag ikke opprettes. Brukes bare for å sjekke skjema og tilganger lokalt.",
      confidence: 0.5,
      inferred: true,
      status: "pending_review",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;

  return { batchId, proposalId: prop!.id as string };
}
