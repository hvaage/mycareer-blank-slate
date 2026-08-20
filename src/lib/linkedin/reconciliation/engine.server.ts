// Serveronly: deterministisk avstemmingsmotor for LinkedIn-import (Fase 3).
//
// Kontrakt:
//   - leser kun linkedin_*-staging og leser produktdata READ-ONLY
//   - skriver kun til linkedin_reconciliation_*-tabellene
//   - ingen KI, ingen eksterne kall, ingen tilfeldighet
//   - hvert forslag fryser et minimert kildesnapshot og et målsnapshot

import type { LinkedInPurpose } from "../contract";
import {
  RECONCILIATION_VERSION,
  RECONCILIATION_NORMALIZATION_VERSION,
  computeInputSignature,
  hashSnapshot,
  monthKey,
  normKey,
  orgKey,
  periodsOverlap,
  snapshotText,
  titleKey,
  tokenSimilarity,
  type ProposalDraft,
} from "./contract.server";

// Avstemmingstabellene er nye og ligger ikke i den genererte typefila ennå.
// Motoren bruker derfor en løs klienttype og validerer feltene selv.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = import("@supabase/supabase-js").SupabaseClient<any, "public", any>;

export type ReconcileResult = {
  ok: boolean;
  runs: Array<{
    purpose: LinkedInPurpose;
    runId: string | null;
    status: string;
    skipReason?: string;
    proposals: number;
    reused?: boolean;
  }>;
  error?: string;
};

type StagingRow = {
  id: string;
  staging_domain: string;
  record_kind: string;
  purpose: string;
  source_file: string;
  source_row_number: number | null;
  source_classification: "A" | "B";
  source_identity_hash: string;
};

/** Kjør avstemming for alle valgte formål på én import. */
export async function runReconciliation(
  admin: Admin,
  input: { userId: string; importId: string },
): Promise<ReconcileResult> {
  const authorHmacSecret = process.env["LINKEDIN_AUTHOR_HMAC_SECRET"] ?? "";

  const { data: purposeRows, error: purposeError } = await admin
    .from("linkedin_import_purposes")
    .select("purpose")
    .eq("linkedin_import_id", input.importId)
    .eq("user_id", input.userId);
  if (purposeError) return { ok: false, runs: [], error: "database_error" };

  const selected = new Set((purposeRows ?? []).map((r) => r.purpose as LinkedInPurpose));
  const allPurposes: LinkedInPurpose[] = [
    "profile",
    "career",
    "network",
    "jobs",
    "learning",
    "content",
  ];

  const target = await loadTargetSnapshot(admin, input.userId);
  const runs: ReconcileResult["runs"] = [];

  for (const purpose of allPurposes) {
    if (purpose === "jobs") {
      // Produktkontrakt v1.1: "jobs" er ekskludert fra avstemming i Fase 3
      // og behandles som om formålet aldri var valgt.
      runs.push({
        purpose,
        runId: null,
        status: "cancelled",
        skipReason: "excluded_by_product_contract_v1_1",
        proposals: 0,
      });
      continue;
    }
    if (!selected.has(purpose)) {
      runs.push({
        purpose,
        runId: null,
        status: "cancelled",
        skipReason: "skipped_no_selected_purpose",
        proposals: 0,
      });
      continue;
    }
    runs.push(await reconcilePurpose(admin, input, purpose, target, authorHmacSecret));
  }

  return { ok: true, runs };
}

// ---------------------------------------------------------------
// Målgrunnlag (produktdata, kun lesing)
// ---------------------------------------------------------------

type TargetSnapshot = {
  signature: string;
  profile: Record<string, unknown> | null;
  roles: Array<{
    id: string;
    title: string;
    employer: string;
    startDate: string | null;
    endDate: string | null;
  }>;
  qualifications: Array<{ id: string; type: string; label: string }>;
  skills: Array<{ id: string; label: string }>;
  contacts: Array<{ id: string; name: string; url: string | null; email: string | null }>;
};

async function loadTargetSnapshot(admin: Admin, userId: string): Promise<TargetSnapshot> {
  const [{ data: profile }, { data: atoms }, { data: contacts }] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, full_name, headline, bio, current_employer, current_role_title, target_city, industries, languages, skills",
      )
      .eq("id", userId)
      .maybeSingle(),
    admin
      .from("career_atoms")
      .select("id, atom_type, content_no, structured_data, is_active")
      .eq("user_id", userId)
      .eq("is_active", true),
    admin.from("contacts").select("id, name, linkedin_url, email").eq("user_id", userId),
  ]);

  const roles: TargetSnapshot["roles"] = [];
  const qualifications: TargetSnapshot["qualifications"] = [];
  const skills: TargetSnapshot["skills"] = [];

  for (const atom of atoms ?? []) {
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
    const label = (sd["title"] as string) || atom.content_no || "";
    if (atom.atom_type === "role") {
      roles.push({
        id: atom.id,
        title: String(sd["title"] ?? ""),
        employer: String(sd["employer"] ?? ""),
        startDate: (sd["start_date"] as string) ?? null,
        endDate: (sd["end_date"] as string) ?? null,
      });
    } else if (atom.atom_type === "skill") {
      skills.push({ id: atom.id, label });
    } else if (
      atom.atom_type === "education" ||
      atom.atom_type === "certification" ||
      atom.atom_type === "language"
    ) {
      qualifications.push({ id: atom.id, type: atom.atom_type, label });
    }
  }

  const signature = await hashSnapshot({
    profile: profile ?? null,
    roles: roles.map((r) => [orgKey(r.employer), titleKey(r.title), r.startDate, r.endDate]),
    qualifications: qualifications.map((q) => [q.type, normKey(q.label)]),
    skills: skills.map((s) => normKey(s.label)),
    contacts: (contacts ?? []).map((c) => normKey(c.name)),
  });

  return {
    signature,
    profile: (profile as Record<string, unknown>) ?? null,
    roles,
    qualifications,
    skills,
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? "",
      url: c.linkedin_url ?? null,
      email: c.email ?? null,
    })),
  };
}

// ---------------------------------------------------------------
// Kjøring per formål
// ---------------------------------------------------------------

async function reconcilePurpose(
  admin: Admin,
  input: { userId: string; importId: string },
  purpose: LinkedInPurpose,
  target: TargetSnapshot,
  authorHmacSecret: string,
): Promise<ReconcileResult["runs"][number]> {
  const { data: linkRows } = await admin
    .from("linkedin_import_stage_records")
    .select("staging_record_id")
    .eq("linkedin_import_id", input.importId)
    .eq("user_id", input.userId)
    .eq("purpose", purpose);

  const recordIds = (linkRows ?? []).map((r) => r.staging_record_id);
  if (recordIds.length === 0) {
    return {
      purpose,
      runId: null,
      status: "succeeded",
      skipReason: "skipped_no_source_records",
      proposals: 0,
    };
  }

  const { data: stagingRows } = await admin
    .from("linkedin_staging_records")
    .select(
      "id, staging_domain, record_kind, purpose, source_file, source_row_number, source_classification, source_identity_hash",
    )
    .in("id", recordIds);

  const staging = (stagingRows ?? []) as StagingRow[];
  const signature = await computeInputSignature({
    userId: input.userId,
    importId: input.importId,
    purpose,
    sourceIdentityHashes: staging.map((s) => s.source_identity_hash),
    targetSignature: target.signature,
  });

  const { data: existingRun } = await admin
    .from("linkedin_reconciliation_runs")
    .select("id, status, proposal_count")
    .eq("user_id", input.userId)
    .eq("input_signature", signature)
    .neq("status", "cancelled")
    .maybeSingle();
  if (existingRun) {
    return {
      purpose,
      runId: existingRun.id,
      status: existingRun.status,
      proposals: existingRun.proposal_count ?? 0,
      reused: true,
    };
  }

  const { data: run, error: runError } = await admin
    .from("linkedin_reconciliation_runs")
    .insert({
      user_id: input.userId,
      linkedin_import_id: input.importId,
      purpose,
      reconciliation_version: RECONCILIATION_VERSION,
      normalization_version: RECONCILIATION_NORMALIZATION_VERSION,
      status: "running",
      started_at: new Date().toISOString(),
      input_signature: signature,
      source_record_count: staging.length,
    })
    .select("id")
    .single();
  if (runError || !run) {
    return { purpose, runId: null, status: "failed", proposals: 0 };
  }

  let drafts: ProposalDraft[] = [];
  try {
    drafts = await buildDrafts(admin, purpose, staging, target, authorHmacSecret);
  } catch {
    await admin
      .from("linkedin_reconciliation_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_code: "engine_error" })
      .eq("id", run.id);
    return { purpose, runId: run.id, status: "failed", proposals: 0 };
  }

  await persistDrafts(admin, {
    userId: input.userId,
    importId: input.importId,
    purpose,
    runId: run.id,
    drafts,
  });

  const counts = {
    created_count: drafts.filter((d) => d.kind === "create").length,
    match_count: drafts.filter((d) => d.kind === "keep_existing" || d.kind === "possible_update").length,
    possible_duplicate_count: drafts.filter((d) => d.kind === "possible_duplicate").length,
    conflict_count: drafts.filter((d) => d.kind === "conflict").length,
    skipped_count: drafts.filter((d) => d.kind === "not_actionable_in_phase_3").length,
  };

  await admin
    .from("linkedin_reconciliation_runs")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      proposal_count: drafts.length,
      ...counts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return { purpose, runId: run.id, status: "succeeded", proposals: drafts.length };
}

async function persistDrafts(
  admin: Admin,
  args: {
    userId: string;
    importId: string;
    purpose: LinkedInPurpose;
    runId: string;
    drafts: ProposalDraft[];
  },
) {
  for (const draft of args.drafts) {
    const sourceHash = await hashSnapshot(draft.sourceSnapshot);
    const targetHash = draft.targetSnapshot ? await hashSnapshot(draft.targetSnapshot) : null;

    const { data: proposal, error } = await admin
      .from("linkedin_reconciliation_proposals")
      .insert({
        user_id: args.userId,
        reconciliation_run_id: args.runId,
        linkedin_import_id: args.importId,
        purpose: args.purpose,
        proposal_domain: draft.domain,
        proposal_kind: draft.kind,
        confidence: draft.confidence,
        match_method: draft.matchMethod,
        dedupe_key: draft.dedupeKey,
        source_classification: draft.sourceClassification,
        source_snapshot_json: draft.sourceSnapshot,
        source_snapshot_hash: sourceHash,
        target_snapshot_json: draft.targetSnapshot,
        target_snapshot_hash: targetHash,
        proposed_payload_json: draft.proposedPayload,
        comparison_json: draft.comparison,
        reason_codes: draft.reasonCodes,
        review_message: draft.reviewMessage,
        reconciliation_version: RECONCILIATION_VERSION,
      })
      .select("id")
      .single();
    if (error || !proposal) continue;

    if (draft.sources.length > 0) {
      await admin.from("linkedin_reconciliation_proposal_sources").insert(
        draft.sources.map((s) => ({
          proposal_id: proposal.id,
          user_id: args.userId,
          linkedin_staging_record_id: s.stagingRecordId,
          source_role: s.role,
          source_reference_json: s.reference,
        })),
      );
    }
  }
}

// ---------------------------------------------------------------
// Domeneregler
// ---------------------------------------------------------------

async function buildDrafts(
  admin: Admin,
  purpose: LinkedInPurpose,
  staging: StagingRow[],
  target: TargetSnapshot,
  authorHmacSecret: string,
): Promise<ProposalDraft[]> {
  const byId = new Map(staging.map((s) => [s.id, s]));
  const ids = staging.map((s) => s.id);
  const ref = (row: StagingRow) => ({
    source_file: row.source_file,
    source_row_number: row.source_row_number,
    record_kind: row.record_kind,
  });

  if (purpose === "profile") {
    const { data } = await admin
      .from("linkedin_profile_staging")
      .select("staging_record_id, first_name, last_name, headline, summary, industry, geo_location")
      .in("staging_record_id", ids);
    return (data ?? []).flatMap((row) =>
      profileDrafts(row, byId.get(row.staging_record_id)!, target, ref),
    );
  }

  if (purpose === "career") {
    const [{ data: career }, { data: recommendations }] = await Promise.all([
      admin
        .from("linkedin_career_staging")
        .select(
          "staging_record_id, entry_kind, organization_name, title, location, description, started_on, finished_on",
        )
        .in("staging_record_id", ids),
      admin
        .from("linkedin_recommendation_staging")
        .select("staging_record_id, direction, counterpart_name, counterpart_headline, counterpart_profile_url, status")
        .in("staging_record_id", ids),
    ]);

    const drafts: ProposalDraft[] = [];
    for (const row of career ?? []) {
      const src = byId.get(row.staging_record_id);
      if (!src) continue;
      if (row.entry_kind === "position") drafts.push(positionDraft(row, src, target, ref));
      else if (row.entry_kind === "skill") drafts.push(skillDraft(row, src, target, ref));
      else drafts.push(qualificationDraft(row, src, target, ref));
    }
    for (const row of recommendations ?? []) {
      const src = byId.get(row.staging_record_id);
      if (!src) continue;
      drafts.push(await recommendationDraft(row, src, ref, authorHmacSecret));
    }
    return drafts;
  }

  if (purpose === "network") {
    const { data } = await admin
      .from("linkedin_network_staging")
      .select("staging_record_id, full_name, company, position, connected_on, profile_url")
      .in("staging_record_id", ids);
    return (data ?? [])
      .map((row) => {
        const src = byId.get(row.staging_record_id);
        return src ? networkDraft(row, src, target, ref) : null;
      })
      .filter((d): d is ProposalDraft => d !== null);
  }

  if (purpose === "jobs") {
    const { data } = await admin
      .from("linkedin_job_staging")
      .select("staging_record_id, entry_kind, company_name, job_title, job_url, application_state, event_label")
      .in("staging_record_id", ids);
    return (data ?? [])
      .map((row) => {
        const src = byId.get(row.staging_record_id);
        return src ? jobDraft(row, src, ref) : null;
      })
      .filter((d): d is ProposalDraft => d !== null);
  }

  if (purpose === "learning") {
    const { data } = await admin
      .from("linkedin_learning_staging")
      .select("staging_record_id, course_title, provider, completed_on, progress_label")
      .in("staging_record_id", ids);
    return (data ?? [])
      .map((row) => {
        const src = byId.get(row.staging_record_id);
        return src ? learningDraft(row, src, target, ref) : null;
      })
      .filter((d): d is ProposalDraft => d !== null);
  }

  // content: ikke handlingsbart i Fase 3
  return staging.map((src) => ({
    domain: "content" as const,
    kind: "not_actionable_in_phase_3" as const,
    dedupeKey: `content:${src.source_identity_hash}`,
    confidence: 0,
    matchMethod: "none" as const,
    sourceClassification: src.source_classification,
    sourceSnapshot: { record_kind: src.record_kind, source_file: src.source_file },
    targetSnapshot: null,
    proposedPayload: null,
    comparison: {},
    reasonCodes: ["not_actionable_in_phase_3"],
    reviewMessage: "Innhold fra LinkedIn kan lagres som kildemateriale senere, men foreslår ingen endring nå.",
    sources: [{ stagingRecordId: src.id, role: "primary" as const, reference: ref(src) }],
  }));
}

type RefFn = (row: StagingRow) => Record<string, unknown>;

function profileDrafts(
  row: {
    staging_record_id: string;
    first_name: string | null;
    last_name: string | null;
    headline: string | null;
    summary: string | null;
    industry: string | null;
    geo_location: string | null;
  },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft[] {
  const fields: Array<[string, string | null, string | null, string]> = [
    [
      "full_name",
      [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      (target.profile?.["full_name"] as string) ?? null,
      "Navn",
    ],
    ["headline", row.headline, (target.profile?.["headline"] as string) ?? null, "Tittelrad"],
    ["bio", row.summary, (target.profile?.["bio"] as string) ?? null, "Sammendrag"],
    ["target_city", row.geo_location, (target.profile?.["target_city"] as string) ?? null, "Sted"],
  ];

  return fields
    .filter(([, sourceValue]) => Boolean(snapshotText(sourceValue)))
    .map(([field, sourceValue, targetValue, label]) => {
      const s = snapshotText(sourceValue);
      const t = snapshotText(targetValue);
      const same = normKey(s) === normKey(t) && Boolean(t);
      const kind = !t ? "create" : same ? "keep_existing" : "conflict";
      return {
        domain: "profile" as const,
        kind: kind as ProposalDraft["kind"],
        dedupeKey: `profile:${field}`,
        confidence: !t ? 0.7 : same ? 1 : 0.5,
        matchMethod: "field_diff" as const,
        sourceClassification: src.source_classification,
        sourceSnapshot: { field, label, value: s },
        targetSnapshot: { field, value: t },
        proposedPayload: kind === "keep_existing" ? null : { field, value: s },
        comparison: { field, source: s, target: t, equal: same },
        reasonCodes: [kind === "conflict" ? "value_differs" : kind === "create" ? "missing_in_product" : "identical"],
        reviewMessage:
          kind === "create"
            ? `${label} finnes i LinkedIn-eksporten, men ikke i profilen din.`
            : same
              ? `${label} er allerede likt i profilen din.`
              : `${label} er ulikt i LinkedIn-eksporten og profilen din. Velg hva som skal gjelde.`,
        sources: [{ stagingRecordId: src.id, role: "primary" as const, reference: ref(src) }],
      };
    });
}

function positionDraft(
  row: {
    staging_record_id: string;
    organization_name: string | null;
    title: string | null;
    location: string | null;
    description: string | null;
    started_on: string | null;
    finished_on: string | null;
  },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft {
  const employer = orgKey(row.organization_name);
  const title = titleKey(row.title);

  let best: { role: TargetSnapshot["roles"][number]; score: number } | null = null;
  for (const role of target.roles) {
    const employerScore = Math.max(
      orgKey(role.employer) === employer && employer ? 1 : 0,
      tokenSimilarity(orgKey(role.employer), employer),
    );
    if (employerScore < 0.5) continue;
    const titleScore = Math.max(
      titleKey(role.title) === title && title ? 1 : 0,
      tokenSimilarity(titleKey(role.title), title),
    );
    const overlap = periodsOverlap(row.started_on, row.finished_on, role.startDate, role.endDate);
    const score = employerScore * 0.45 + titleScore * 0.35 + (overlap ? 0.2 : 0);
    if (!best || score > best.score) best = { role, score };
  }

  const sourceSnapshot = {
    employer: snapshotText(row.organization_name),
    title: snapshotText(row.title),
    location: snapshotText(row.location),
    description: snapshotText(row.description),
    start_date: monthKey(row.started_on),
    end_date: monthKey(row.finished_on),
  };
  const base = {
    domain: "career" as const,
    dedupeKey: `career:position:${employer}|${title}|${monthKey(row.started_on) ?? ""}`,
    sourceClassification: src.source_classification,
    sourceSnapshot,
    sources: [{ stagingRecordId: src.id, role: "primary" as const, reference: ref(src) }],
  };

  if (!best || best.score < 0.55) {
    return {
      ...base,
      kind: "create",
      confidence: 0.75,
      matchMethod: "none",
      targetSnapshot: null,
      proposedPayload: { atom_type: "role", ...sourceSnapshot },
      comparison: { matched: false },
      reasonCodes: ["missing_in_product"],
      reviewMessage: `Ny rolle fra LinkedIn: ${sourceSnapshot.title ?? "uten tittel"} hos ${sourceSnapshot.employer ?? "ukjent arbeidsgiver"}.`,
    };
  }

  const targetSnapshot = {
    atom_id: best.role.id,
    employer: best.role.employer,
    title: best.role.title,
    start_date: monthKey(best.role.startDate),
    end_date: monthKey(best.role.endDate),
  };
  const diffs: string[] = [];
  if (titleKey(best.role.title) !== title) diffs.push("title");
  if (monthKey(best.role.startDate) !== monthKey(row.started_on)) diffs.push("start_date");
  if (monthKey(best.role.endDate) !== monthKey(row.finished_on)) diffs.push("end_date");

  if (diffs.length === 0) {
    return {
      ...base,
      kind: "keep_existing",
      confidence: 0.95,
      matchMethod: "normalized_key",
      targetSnapshot,
      proposedPayload: null,
      comparison: { matched: true, diffs },
      reasonCodes: ["identical"],
      reviewMessage: `Rollen finnes allerede: ${best.role.title} hos ${best.role.employer}.`,
    };
  }

  return {
    ...base,
    kind: best.score >= 0.8 ? "possible_update" : "possible_duplicate",
    confidence: Math.min(0.9, best.score),
    matchMethod: best.score >= 0.8 ? "normalized_key" : "fuzzy_name_period",
    targetSnapshot,
    proposedPayload: { atom_id: best.role.id, changes: diffs, ...sourceSnapshot },
    comparison: { matched: true, diffs, score: Number(best.score.toFixed(3)) },
    reasonCodes: diffs.map((d) => `differs_${d}`),
    reviewMessage: `LinkedIn beskriver denne rollen litt annerledes enn det du har lagret (${diffs.join(", ")}).`,
  };
}

function skillDraft(
  row: { staging_record_id: string; title: string | null; organization_name: string | null },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft {
  const label = snapshotText(row.title) ?? snapshotText(row.organization_name);
  const key = normKey(label);
  const match = target.skills.find((s) => normKey(s.label) === key);
  return {
    domain: "career",
    kind: match ? "keep_existing" : "create",
    dedupeKey: `career:skill:${key}`,
    confidence: match ? 0.95 : 0.4,
    matchMethod: match ? "normalized_key" : "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: { kind: "skill", label },
    targetSnapshot: match ? { atom_id: match.id, label: match.label } : null,
    proposedPayload: match ? null : { atom_type: "skill", label },
    comparison: { matched: Boolean(match) },
    reasonCodes: match ? ["identical"] : ["missing_in_product", "requires_evidence"],
    reviewMessage: match
      ? `Kompetansen «${label}» er allerede registrert.`
      : `LinkedIn oppgir kompetansen «${label}». Den må knyttes til konkret erfaring før den kan brukes.`,
    sources: [{ stagingRecordId: src.id, role: "primary", reference: ref(src) }],
  };
}

function qualificationDraft(
  row: {
    staging_record_id: string;
    entry_kind: string;
    organization_name: string | null;
    title: string | null;
    started_on: string | null;
    finished_on: string | null;
  },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft {
  const label = snapshotText(row.title) ?? snapshotText(row.organization_name);
  const key = normKey(label);
  const match = target.qualifications.find((q) => normKey(q.label) === key);
  return {
    domain: "career",
    kind: match ? "keep_existing" : "create",
    dedupeKey: `career:${row.entry_kind}:${key}`,
    confidence: match ? 0.95 : 0.7,
    matchMethod: match ? "normalized_key" : "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: {
      kind: row.entry_kind,
      label,
      issuer: snapshotText(row.organization_name),
      start_date: monthKey(row.started_on),
      end_date: monthKey(row.finished_on),
    },
    targetSnapshot: match ? { atom_id: match.id, label: match.label, type: match.type } : null,
    proposedPayload: match ? null : { atom_type: row.entry_kind, label },
    comparison: { matched: Boolean(match) },
    reasonCodes: match ? ["identical"] : ["missing_in_product"],
    reviewMessage: match
      ? `«${label}» er allerede registrert.`
      : `Ny kvalifikasjon fra LinkedIn: «${label}».`,
    sources: [{ stagingRecordId: src.id, role: "primary", reference: ref(src) }],
  };
}

async function recommendationDraft(
  row: {
    staging_record_id: string;
    direction: string;
    counterpart_name: string | null;
    counterpart_headline: string | null;
    counterpart_profile_url: string | null;
  },
  src: StagingRow,
  ref: RefFn,
  authorHmacSecret: string,
): Promise<ProposalDraft> {
  const isEndorsement = src.record_kind.startsWith("endorsement");
  // Retning skal alltid være avledet fra kildens record_kind når feltet
  // mangler eller er tomt, slik at "given"/"received" aldri er udefinert.
  const direction =
    row.direction || (src.record_kind.includes("received") ? "received" : "given");

  const { hashRecommendationAuthor } = await import("@/lib/linkedin/hmac.server");
  const authorIdentityHash =
    direction === "received" && authorHmacSecret
      ? await hashRecommendationAuthor({
          authorName: row.counterpart_name,
          profileUrl: row.counterpart_profile_url,
          secret: authorHmacSecret,
        })
      : null;

  return {
    domain: isEndorsement ? "endorsements" : "recommendations",
    kind: "not_actionable_in_phase_3",
    dedupeKey: `${isEndorsement ? "endorsement" : "recommendation"}:${src.source_identity_hash}`,
    confidence: 0.2,
    matchMethod: "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: {
      direction,
      counterpart: snapshotText(row.counterpart_name),
      counterpart_headline: snapshotText(row.counterpart_headline),
      author_identity_hash: authorIdentityHash,
    },
    targetSnapshot: null,
    proposedPayload: null,
    comparison: {},
    reasonCodes: ["third_party_statement"],
    reviewMessage:
      "Dette er en uttalelse fra en annen person. Den kan brukes som kontekst, men aldri som belegg for dine egne påstander.",
    sources: [
      {
        stagingRecordId: src.id,
        role: isEndorsement ? "third_party_signal" : "third_party_recommendation",
        reference: ref(src),
      },
    ],
  };
}

function networkDraft(
  row: {
    staging_record_id: string;
    full_name: string | null;
    company: string | null;
    position: string | null;
    profile_url: string | null;
  },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft {
  const url = normKey(row.profile_url);
  const name = normKey(row.full_name);
  const match =
    (url && target.contacts.find((c) => normKey(c.url) === url)) ||
    target.contacts.find((c) => normKey(c.name) === name && name.length > 0) ||
    null;

  return {
    domain: "network",
    kind: match ? "keep_existing" : "create",
    dedupeKey: `network:${url || name || src.source_identity_hash}`,
    confidence: match ? 0.9 : 0.45,
    matchMethod: match ? (url ? "url_match" : "normalized_key") : "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: {
      name: snapshotText(row.full_name),
      company: snapshotText(row.company),
      position: snapshotText(row.position),
      profile_url: snapshotText(row.profile_url),
    },
    targetSnapshot: match ? { contact_id: match.id, name: match.name } : null,
    proposedPayload: match
      ? null
      : { name: snapshotText(row.full_name), linkedin_url: snapshotText(row.profile_url) },
    comparison: { matched: Boolean(match) },
    reasonCodes: match ? ["identical"] : ["missing_in_product", "third_party_person"],
    reviewMessage: match
      ? `Kontakten «${row.full_name}» finnes allerede.`
      : `LinkedIn-forbindelse som kan legges til som kontakt: «${row.full_name}».`,
    sources: [{ stagingRecordId: src.id, role: "primary", reference: ref(src) }],
  };
}

function jobDraft(
  row: {
    staging_record_id: string;
    entry_kind: string;
    company_name: string | null;
    job_title: string | null;
    job_url: string | null;
    application_state: string | null;
    event_label: string | null;
  },
  src: StagingRow,
  ref: RefFn,
): ProposalDraft {
  const isPreference = row.entry_kind === "job_seeker_preference" || row.entry_kind === "job_alert";
  return {
    domain: "jobs",
    kind: isPreference ? "create" : "not_actionable_in_phase_3",
    dedupeKey: `jobs:${row.entry_kind}:${src.source_identity_hash}`,
    confidence: isPreference ? 0.5 : 0.2,
    matchMethod: "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: {
      entry_kind: row.entry_kind,
      company: snapshotText(row.company_name),
      title: snapshotText(row.job_title),
      url: snapshotText(row.job_url),
      state: snapshotText(row.application_state),
      label: snapshotText(row.event_label),
    },
    targetSnapshot: null,
    proposedPayload: isPreference
      ? { preference_hint: snapshotText(row.event_label) ?? snapshotText(row.job_title) }
      : null,
    comparison: {},
    reasonCodes: isPreference ? ["preference_signal"] : ["historical_activity"],
    reviewMessage: isPreference
      ? "LinkedIn-signal om jobbønsker. Kan foreslås som preferanse, aldri som bekreftet erfaring."
      : "Historisk jobbaktivitet fra LinkedIn. Vises som kontekst, foreslår ingen endring.",
    sources: [{ stagingRecordId: src.id, role: "primary", reference: ref(src) }],
  };
}

function learningDraft(
  row: {
    staging_record_id: string;
    course_title: string | null;
    provider: string | null;
    completed_on: string | null;
    progress_label: string | null;
  },
  src: StagingRow,
  target: TargetSnapshot,
  ref: RefFn,
): ProposalDraft {
  const label = snapshotText(row.course_title);
  const key = normKey(label);
  const match = target.qualifications.find((q) => normKey(q.label) === key);
  const completed = Boolean(monthKey(row.completed_on));
  return {
    domain: "learning",
    kind: match ? "keep_existing" : completed ? "create" : "not_actionable_in_phase_3",
    dedupeKey: `learning:${key || src.source_identity_hash}`,
    confidence: match ? 0.9 : completed ? 0.6 : 0.2,
    matchMethod: match ? "normalized_key" : "none",
    sourceClassification: src.source_classification,
    sourceSnapshot: {
      course: label,
      provider: snapshotText(row.provider),
      completed_on: monthKey(row.completed_on),
      progress: snapshotText(row.progress_label),
    },
    targetSnapshot: match ? { atom_id: match.id, label: match.label } : null,
    proposedPayload: match || !completed ? null : { atom_type: "certification", label },
    comparison: { matched: Boolean(match), completed },
    reasonCodes: match ? ["identical"] : completed ? ["missing_in_product"] : ["not_completed"],
    reviewMessage: match
      ? `«${label}» er allerede registrert.`
      : completed
        ? `Fullført LinkedIn Learning-kurs: «${label}».`
        : `Påbegynt kurs «${label}». Foreslår ingen endring før det er fullført.`,
    sources: [{ stagingRecordId: src.id, role: "primary", reference: ref(src) }],
  };
}
