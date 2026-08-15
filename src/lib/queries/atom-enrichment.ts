// Karriereontologi v4, fase 2.2. @ts-nocheck er fjernet med vilje: typekontrollen er
// det som fanger feil måltabell, feil felttype og manglende peker-ID-er.
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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

/**
 * Taket på hvor mange forslag en statusliste henter. Listen er et utsnitt når
 * antallet treffer taket, og UI-et MÅ merke det til paginering er bygget.
 */
export const ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT = 80;

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
        // NB: taket kutter ved ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT. Listen er da
        // et utsnitt, ikke alt — merkes i UI til paginering finnes.
        .limit(ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT);
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

function strArrayField(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

/** Klasser som bare kan belegges indirekte — de krever pekere til andre atomer. */
const ATOM_TYPES_REQUIRING_EVIDENCE_POINTERS = new Set(["skill", "domain"]);

const CAREER_ATOM_KINDS = new Set([
  "evidens",
  "mangel",
  "onske",
  "maal",
  "begrensning",
  "verdi",
]);

const CAREER_ATOM_TYPES = new Set([
  "role",
  "achievement",
  "metric",
  "context",
  "tool",
  "education",
  "skill",
  "domain",
  "language",
  "certification",
  "project",
  "volunteer",
  "summary_fragment",
]);

const CAREER_ATOM_CONFIDENCE = new Set(["imported", "inferred", "verified"]);

async function assertCareerAtomEditable(userId: string, atomId: string): Promise<void> {
  const { data, error } = await supabase
    .from("career_atoms")
    .select("id, user_locked")
    .eq("id", atomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke karriereatomet.");
  if (data.user_locked) {
    throw new Error(
      "Atomet er låst av deg og kan ikke endres via AI-forslag. Rediger selv under Karriereprofil.",
    );
  }
}

/**
 * Bygger et career_atoms-innslag fra forslagets payload.
 *
 * Regler som håndheves her:
 * - `atom_class` og `attestation` settes aldri herfra (databasen eier dem).
 * - `confidence` er en opprinnelsesakse (imported/inferred/verified) og har ingenting
 *   med forslagets numeriske `confidence_score` å gjøre. De konverteres ikke.
 * - Indirekte klasser (kompetanse/eksponering) krever `evidence_atom_ids`.
 */
function buildCareerAtomFields(
  payload: Record<string, unknown>,
  row: AtomEnrichmentProposalRow,
): {
  atom_kind: string;
  atom_type: string | null;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: Json;
  source_type: string;
  source_ref: string | null;
  source_quote: string | null;
  evidence_atom_ids: string[];
  confidence: string;
  viktighet: number | null;
  is_active: boolean;
} {
  const atomKind = strField(payload, "atom_kind")?.trim() ?? "";
  if (!CAREER_ATOM_KINDS.has(atomKind)) {
    throw new Error(
      `Forslaget mangler gyldig atom_kind (fikk «${atomKind || "ingen"}»). Forslaget må regenereres mot karriereontologi v4.`,
    );
  }
  const rawType = strField(payload, "atom_type")?.trim() || null;
  if (atomKind === "evidens") {
    if (!rawType || !CAREER_ATOM_TYPES.has(rawType)) {
      throw new Error(
        `Evidensforslag krever gyldig atom_type (fikk «${rawType ?? "ingen"}»).`,
      );
    }
  } else if (rawType) {
    throw new Error("atom_type kan bare brukes for evidens-atomer.");
  }

  const evidenceAtomIds = strArrayField(payload, "evidence_atom_ids");
  if (rawType && ATOM_TYPES_REQUIRING_EVIDENCE_POINTERS.has(rawType) && evidenceAtomIds.length === 0) {
    throw new Error(
      "Forslaget mangler evidence_atom_ids. Kompetanse og eksponering kan bare belegges indirekte, via pekere til kvalifikasjons-, resultat- eller rolleatomer.",
    );
  }

  const parentAtomId = strField(payload, "parent_atom_id");
  if (rawType === "domain" && !parentAtomId) {
    throw new Error(
      "Eksponering (atom_type=domain) krever parent_atom_id som peker på et rolleatom.",
    );
  }

  const contentNo = strField(payload, "content_no")?.trim() || null;
  const contentEn = strField(payload, "content_en")?.trim() || null;
  if (!contentNo && !contentEn) {
    throw new Error("Forslaget mangler innhold (content_no eller content_en).");
  }

  const confidence = strField(payload, "confidence")?.trim() || "inferred";
  if (!CAREER_ATOM_CONFIDENCE.has(confidence)) {
    throw new Error(
      `Ugyldig confidence «${confidence}». Gyldige verdier: imported, inferred, verified. Merk at forslagets numeriske confidence_score er en annen akse og ikke skal konverteres hit.`,
    );
  }

  const viktighetRaw = numField(payload, "viktighet");
  let viktighet: number | null = null;
  if (viktighetRaw != null) {
    if (!["onske", "verdi", "begrensning"].includes(atomKind)) {
      throw new Error("viktighet gjelder bare onske, verdi og begrensning.");
    }
    const rounded = Math.round(viktighetRaw);
    if (rounded < 1 || rounded > 6) {
      throw new Error("viktighet må ligge på 1–6-skalaen og skal ikke normaliseres.");
    }
    viktighet = rounded;
  }

  const structured = payload["structured_data"];
  const structuredData: Json =
    structured != null && typeof structured === "object" && !Array.isArray(structured)
      ? (structured as Json)
      : ({} as Json);

  return {
    atom_kind: atomKind,
    atom_type: rawType,
    parent_atom_id: parentAtomId,
    content_no: contentNo,
    content_en: contentEn,
    structured_data: structuredData,
    source_type: strField(payload, "source_type")?.trim() || row.source_type || "enrichment",
    source_ref: strField(payload, "source_ref") ?? row.source_id ?? null,
    source_quote: strField(payload, "source_quote"),
    evidence_atom_ids: evidenceAtomIds,
    confidence,
    viktighet,
    is_active: payload["is_active"] !== false,
  };
}

/**
 * Applies an approved proposal to user-owned atoms only.
 * Karriereontologi v4: `career_atoms` er eneste måltabell for brukeratomer.
 * Target-side atoms stay schema-ready; application is deferred (review-only in UI).
 */
async function applyApprovedUserAtomProposal(
  userId: string,
  row: AtomEnrichmentProposalRow,
): Promise<void> {
  const payload = asRecord(row.proposal_payload);
  const action = row.proposal_action;

  if (
    row.target_atom_type === "user_preference_atom" ||
    row.target_atom_type === "user_evidence_atom"
  ) {
    throw new Error(
      "Forslaget peker på den utfasede atommodellen (user_preference_atoms / user_evidence_atoms). Det må regenereres mot career_atoms før det kan godkjennes.",
    );
  }

  if (row.target_atom_type === "career_atom") {
    if (action === "create_atom") {
      const fields = buildCareerAtomFields(payload, row);
      const { error } = await supabase.from("career_atoms").insert({
        user_id: userId,
        ...fields,
      } as TablesInsert<"career_atoms">);
      if (error) throw error;
      return;
    }
    if (action === "update_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for oppdatering.");
      await assertCareerAtomEditable(userId, tid);
      const fields = buildCareerAtomFields(payload, row);
      const patch: TablesUpdate<"career_atoms"> = {
        content_no: fields.content_no,
        content_en: fields.content_en,
        structured_data: fields.structured_data,
        source_quote: fields.source_quote,
        source_ref: fields.source_ref,
        evidence_atom_ids: fields.evidence_atom_ids,
        parent_atom_id: fields.parent_atom_id,
        confidence: fields.confidence,
        viktighet: fields.viktighet,
        is_active: fields.is_active,
      };
      const { error } = await supabase
        .from("career_atoms")
        .update(patch)
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return;
    }
    if (action === "deactivate_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for deaktivering.");
      await assertCareerAtomEditable(userId, tid);
      const { error } = await supabase
        .from("career_atoms")
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
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "superseded",
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
      superseded_by_proposal_id: supersededByProposalId,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error("Fant ikke forslaget, eller det er ikke lenger til vurdering.");
}

/**
 * Lokal utvikling: oppretter én eksempel-batch med ett ventende forslag (preferanse).
 * Kjør kun når migrasjonen er brukt lokalt. Ikke bruk i produksjon.
 */
export async function insertLocalDevSamplePendingProposal(userId: string): Promise<{
  batchId: string;
  proposalId: string;
} | null> {
  if (!import.meta.env.DEV) {
    // Stille null her ga en «Testforslag opprettet»-toast uten at noe ble opprettet.
    throw new Error("Testforslag kan bare opprettes i utviklingsmiljø.");
  }

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
    atom_kind: "onske",
    content_no: "Ønsker hovedsakelig hjemmekontor med planlagte kontordager.",
    structured_data: { dimensjon: "arbeidsform", etikett: "Hybrid (2–3 dager kontor)" },
    // Opprinnelsesakse, ikke styrke. Skal ikke utledes av forslagets confidence-tall.
    confidence: "inferred",
    viktighet: 5,
    source_type: "dev_seed",
    evidence_atom_ids: [],
  };

  const { data: prop, error: pErr } = await supabase
    .from("atom_enrichment_proposals")
    .insert({
      user_id: userId,
      batch_id: batchId,
      proposal_action: "create_atom",
      target_atom_type: "career_atom",
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
