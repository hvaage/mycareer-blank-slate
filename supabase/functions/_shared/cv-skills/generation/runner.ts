// Serverkjøring av ett genereringssteg for generell CV (fase 4B).
//
// Denne modulen holder modell-, vendor- og nøkkellogikk utenfor src/.
// Worker-ruten laster den dynamisk og kjører nøyaktig ett steg per request.
//
// Skrivekontrakt: kun public.documents, cv_document_blocks, cv_document_claims,
// cv_generation_jobs og ai.model_runs — alt gjennom internal_ai_*-RPC-er.
// career_atoms og cv_parse_candidates røres aldri.

import { callClaude, type ModelProfile } from "../../claude/client.ts";
import { toVendorAtoms, type CareerAtomRow } from "../adapters/career-atom-adapter.ts";
import {
  buildAtsDraft,
  buildGenerationUserPrompt,
  buildQualityInput,
  GENERATION_OUTPUT_CONTRACT_VERSION,
  GENERATION_SYSTEM_PROMPT_NO,
  parseGenerationOutput,
  renderDocumentText,
  sha256Hex,
  snapshotHashInput,
  stableStringify,
  type ContactHeader,
  type GeneratedBlock,
  type GeneratedClaim,
  type GenerationSnapshot,
} from "./contract.ts";
import { checkCvQuality, QUALITY_VERSION } from "../vendor/cv-quality-no/scripts/quality.ts";
import {
  buildRewriteUserPrompt,
  REWRITE_SYSTEM_PROMPT_NO,
} from "../vendor/cv-quality-no/scripts/quality.ts";
import { validateRewriteResponse } from "../vendor/cv-quality-no/scripts/rewrite-validator.ts";
import type { RewriteRequest, RewriteResponse } from "../vendor/cv-quality-no/scripts/types.ts";
import {
  GUARD_VERSION,
  verifyAgainstAtomsFull,
} from "../vendor/cv-hallucination-guard/scripts/guard.ts";
import {
  buildLlmJudgePrompt,
  LLM_JUDGE_SYSTEM_PROMPT,
  parseLlmJudgeResponse,
} from "../vendor/cv-hallucination-guard/scripts/llm-judge.ts";
import type {
  LlmJudgeInput,
  LlmJudgeResponse,
} from "../vendor/cv-hallucination-guard/scripts/types.ts";
import { RULES_VERSION, validateCvDraft } from "../vendor/cv-ats-rules-no/scripts/ats-rules.ts";

export const GENERATION_STEPS = [
  "prepare_snapshot",
  "generate_draft",
  "quality_check",
  "quality_rewrite",
  "rewrite_validation",
  "hallucination_guard",
  "ats_format_check",
  "finalize_for_review",
] as const;
export type GenerationStep = (typeof GENERATION_STEPS)[number];

const TASK_GENERATE = "cv_general_generation";
const TASK_REWRITE = "cv_quality_rewrite";
const TASK_JUDGE = "cv_soft_claim_judge";
const MAX_REWRITES = 1;

export type StepRunInput = {
  adminClient: any;
  anthropicApiKey: string;
  jobId: string;
  workerId: string;
  userId: string;
  step: GenerationStep;
  documentId: string;
  inputPayload: Record<string, unknown>;
  stepState: Record<string, unknown>;
  rewriteCount: number;
  correlationId: string;
};

export type StepRunOutput = {
  step: GenerationStep;
  outcome: string;
  nextStep: GenerationStep | null;
  terminal: "waiting_review" | "failed" | null;
  errorCode: string | null;
  durationMs: number;
  modelRunId: string | null;
};

// --------------------------------------------------------------- profiler

async function loadProfile(
  adminClient: any,
  taskKey: string,
): Promise<{ ok: true; profile: ModelProfile; profileKey: string } | { ok: false }> {
  const { data, error } = await adminClient.rpc("internal_ai_get_active_profile", {
    p_task_key: taskKey,
  });
  if (error || !data) return { ok: false };
  const pj = data as {
    profile_id: string;
    profile_key: string;
    model_id: string;
    prompt_version: string;
    max_tokens: number;
    request_options: Record<string, unknown>;
    capabilities: Record<string, boolean>;
  };
  return {
    ok: true,
    profileKey: pj.profile_key,
    profile: {
      profileId: pj.profile_id,
      taskKey,
      modelId: pj.model_id,
      promptVersion: `${pj.prompt_version}+out${GENERATION_OUTPUT_CONTRACT_VERSION}`,
      maxTokens: pj.max_tokens,
      requestOptions: pj.request_options ?? {},
      capabilities: {
        supportsTemperature: pj.capabilities?.["supportsTemperature"] === true,
        supportsTopP: pj.capabilities?.["supportsTopP"] === true,
        supportsTopK: pj.capabilities?.["supportsTopK"] === true,
        supportsThinking: pj.capabilities?.["supportsThinking"] === true,
        supportsPrefill: pj.capabilities?.["supportsPrefill"] === true,
      },
    },
  };
}

async function startRun(
  adminClient: any,
  input: { correlationId: string; userId: string; taskKey: string; profile: ModelProfile; extra: Record<string, unknown> },
): Promise<string | null> {
  const { data, error } = await adminClient.rpc("internal_ai_start_model_run", {
    p_correlation_id: input.correlationId,
    p_user_id: input.userId,
    p_task_key: input.taskKey,
    p_model_id: input.profile.modelId,
    p_profile_id: input.profile.profileId,
    p_profile_snapshot: {
      prompt_version: input.profile.promptVersion,
      max_tokens: input.profile.maxTokens,
      request_options: input.profile.requestOptions,
      ...input.extra,
    },
    p_api_version: "2023-06-01",
  });
  if (error || typeof data !== "string") return null;
  return data;
}

async function finishRun(
  adminClient: any,
  modelRunId: string,
  r: {
    status: "succeeded" | "failed" | "configuration_error";
    outcome: string | null;
    errorCode: string | null;
    httpStatus: number | null;
    requestId: string | null;
    durationMs: number;
    retryCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
  },
): Promise<void> {
  await adminClient.rpc("internal_ai_finish_model_run", {
    p_model_run_id: modelRunId,
    p_status: r.status,
    p_outcome: r.outcome,
    p_error_code: r.errorCode,
    p_http_status: r.httpStatus,
    p_request_id: r.requestId,
    p_duration_ms: r.durationMs,
    p_retry_count: r.retryCount,
    p_input_tokens: r.inputTokens,
    p_output_tokens: r.outputTokens,
  });
}

// ------------------------------------------------------------- persistens

type CommitInput = {
  step: GenerationStep;
  nextStep: GenerationStep | null;
  newVersion?: boolean;
  contentText?: string | null;
  blocks?: GeneratedBlock[] | null;
  claims?: GeneratedClaim[] | null;
  outputHash?: string | null;
  quality?: unknown;
  guard?: unknown;
  ats?: unknown;
  modelRunId?: string | null;
  terminal?: "waiting_review" | "failed" | null;
  errorCode?: string | null;
  statePatch?: Record<string, unknown>;
};

async function commitStep(
  adminClient: any,
  jobId: string,
  workerId: string,
  c: CommitInput,
): Promise<{ ok: boolean; documentId?: string }> {
  const { data, error } = await adminClient.rpc("internal_ai_generation_commit_step", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_step: c.step,
    p_next_step: c.nextStep,
    p_new_version: c.newVersion === true,
    p_content_text: c.contentText ?? null,
    p_blocks: c.blocks ?? null,
    p_claims: c.claims ?? null,
    p_output_hash: c.outputHash ?? null,
    p_quality: c.quality ?? null,
    p_guard: c.guard ?? null,
    p_ats: c.ats ?? null,
    p_model_run_id: c.modelRunId ?? null,
    p_terminal: c.terminal ?? null,
    p_error_code: c.errorCode ?? null,
    p_state_patch: c.statePatch ?? {},
  });
  if (error) {
    console.error("[cv-generation] commit failed", error.code ?? "unknown");
    return { ok: false };
  }
  const res = (data ?? {}) as { ok?: boolean; document_id?: string };
  return { ok: res.ok === true, ...(res.document_id ? { documentId: res.document_id } : {}) };
}

// ------------------------------------------------------------------ lesing

async function loadDocument(
  adminClient: any,
  documentId: string,
): Promise<{
  snapshot: GenerationSnapshot;
  blocks: GeneratedBlock[];
  claims: GeneratedClaim[];
  contentText: string | null;
} | null> {
  const { data: doc, error } = await adminClient
    .from("documents")
    .select("id, atom_snapshot, content_text")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) return null;
  const { data: blockRows } = await adminClient
    .from("cv_document_blocks")
    .select("block_id, section, ordinal, text, supporting_atom_ids, requirement_atom_ids, claim_ids, source_snapshot_hash")
    .eq("document_id", documentId)
    .order("ordinal");
  const { data: claimRows } = await adminClient
    .from("cv_document_claims")
    .select("claim_id, block_id, claim_type, value, supporting_atom_ids, verification")
    .eq("document_id", documentId);
  return {
    snapshot: (doc.atom_snapshot ?? { atoms: [], preferences: {} }) as GenerationSnapshot,
    contentText: doc.content_text ?? null,
    blocks: (blockRows ?? []).map((b: any) => ({
      blockId: b.block_id,
      section: b.section,
      ordinal: b.ordinal,
      text: b.text,
      supportingAtomIds: b.supporting_atom_ids ?? [],
      requirementAtomIds: b.requirement_atom_ids ?? [],
      claimIds: b.claim_ids ?? [],
      sourceSnapshotHash: b.source_snapshot_hash,
    })),
    claims: (claimRows ?? []).map((c: any) => ({
      claimId: c.claim_id,
      blockId: c.block_id,
      type: c.claim_type,
      value: c.value,
      supportingAtomIds: c.supporting_atom_ids ?? [],
      verification: c.verification,
    })),
  };
}

function contactFrom(payload: Record<string, unknown>): ContactHeader {
  const c = (payload["contact"] ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof c[k] === "string" && c[k] !== "" ? (c[k] as string) : null);
  return {
    full_name: str("full_name") ?? "",
    headline: str("headline"),
    city: str("city"),
    country: str("country"),
    phone: str("phone"),
    email: str("email"),
    linkedin_url: str("linkedin_url"),
  };
}

/** Snapshot-atomer tilbake til radform vendorkoden kan lese. Ingen databaselesing. */
function snapshotAsRows(snapshot: GenerationSnapshot, userId: string): CareerAtomRow[] {
  return (snapshot.atoms ?? []).map((a) => ({
    id: a.id,
    user_id: userId,
    atom_kind: a.atom_kind,
    atom_type: a.atom_type,
    atom_class: a.atom_class,
    parent_atom_id: a.parent_atom_id,
    content_no: a.content_no,
    content_en: a.content_en,
    structured_data: a.structured_data,
    source_type: null,
    source_ref: null,
    source_quote: a.source_quote,
    confidence: a.confidence,
    attestation: null,
    state: "aktiv",
    mangel_state: null,
    user_confirmed: true,
    user_locked: false,
    is_active: true,
    stale_at: null,
    target_position_id: null,
    created_at: snapshot.frozen_at,
    updated_at: snapshot.frozen_at,
  }));
}

// -------------------------------------------------------------------- steg

export async function runGenerationStep(input: StepRunInput): Promise<StepRunOutput> {
  const startedAt = Date.now();
  const done = (o: Omit<StepRunOutput, "durationMs" | "step">): StepRunOutput => ({
    step: input.step,
    durationMs: Date.now() - startedAt,
    ...o,
  });

  const snapshotHash = String(input.inputPayload["snapshot_hash"] ?? "");
  const presentation = (input.inputPayload["presentation"] ?? {}) as Record<string, unknown>;
  const contact = contactFrom(input.inputPayload);

  // ------------------------------------------------------- prepare_snapshot
  if (input.step === "prepare_snapshot") {
    const doc = await loadDocument(input.adminClient, input.documentId);
    if (!doc || (doc.snapshot.atoms ?? []).length === 0) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step,
        nextStep: null,
        terminal: "failed",
        errorCode: "blocked_no_evidence",
      });
      return done({ outcome: "blocked_validation", nextStep: null, terminal: "failed", errorCode: "blocked_no_evidence", modelRunId: null });
    }
    const recomputed = await sha256Hex(snapshotHashInput(doc.snapshot));
    if (snapshotHash && recomputed !== snapshotHash) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step,
        nextStep: null,
        terminal: "failed",
        errorCode: "snapshot_mismatch",
      });
      return done({ outcome: "blocked_validation", nextStep: null, terminal: "failed", errorCode: "snapshot_mismatch", modelRunId: null });
    }
    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: "generate_draft",
      statePatch: { snapshot_atoms: doc.snapshot.atoms.length },
    });
    return done({ outcome: "ok", nextStep: "generate_draft", terminal: null, errorCode: null, modelRunId: null });
  }

  const doc = await loadDocument(input.adminClient, input.documentId);
  if (!doc) {
    return done({ outcome: "provider_error", nextStep: null, terminal: null, errorCode: "document_missing", modelRunId: null });
  }
  const allowedAtomIds = new Set(doc.snapshot.atoms.map((a) => a.id));
  const vendorAtoms = toVendorAtoms(snapshotAsRows(doc.snapshot, input.userId));

  // ---------------------------------------------------------- generate_draft
  if (input.step === "generate_draft") {
    const p = await loadProfile(input.adminClient, TASK_GENERATE);
    if (!p.ok) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: null, terminal: "failed", errorCode: "server_misconfigured",
      });
      return done({ outcome: "configuration_error", nextStep: null, terminal: "failed", errorCode: "server_misconfigured", modelRunId: null });
    }
    const modelRunId = await startRun(input.adminClient, {
      correlationId: input.correlationId,
      userId: input.userId,
      taskKey: TASK_GENERATE,
      profile: p.profile,
      extra: { snapshot_hash: snapshotHash, step: input.step },
    });
    if (!modelRunId) {
      return done({ outcome: "provider_error", nextStep: null, terminal: null, errorCode: "database_error", modelRunId: null });
    }

    const result = await callClaude({
      profile: p.profile,
      system: GENERATION_SYSTEM_PROMPT_NO,
      messages: [
        { role: "user", content: buildGenerationUserPrompt({ snapshot: doc.snapshot, snapshotHash, presentation }) },
      ],
      correlationId: input.correlationId,
      timeoutMs: 180_000,
      maxRetries: 1,
      runtime: { apiKey: input.anthropicApiKey },
    });

    if (!result.ok) {
      const isConfig = result.outcome === "configuration_error";
      await finishRun(input.adminClient, modelRunId, {
        status: isConfig ? "configuration_error" : "failed",
        outcome: isConfig ? "configuration_error" : result.outcome,
        errorCode: result.errorCode,
        httpStatus: result.status,
        requestId: result.requestId,
        durationMs: result.durationMs,
        retryCount: result.retryCount,
        inputTokens: null,
        outputTokens: null,
      });
      if (isConfig) {
        await commitStep(input.adminClient, input.jobId, input.workerId, {
          step: input.step, nextStep: null, terminal: "failed", errorCode: "configuration_error", modelRunId,
        });
        return done({ outcome: "configuration_error", nextStep: null, terminal: "failed", errorCode: "configuration_error", modelRunId });
      }
      // Retrybart: steget står igjen på generate_draft og jobben requeues av worker.
      return done({
        outcome: result.outcome === "timeout" ? "timeout" : "provider_error",
        nextStep: null, terminal: null,
        errorCode: result.errorCode, modelRunId,
      });
    }

    const parsed = parseGenerationOutput(result.text, allowedAtomIds, snapshotHash);
    if (!parsed.ok) {
      await finishRun(input.adminClient, modelRunId, {
        status: "failed", outcome: "invalid_output", errorCode: "blocked_validation",
        httpStatus: 200, requestId: result.requestId, durationMs: result.durationMs,
        retryCount: result.retryCount, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: null, terminal: "failed",
        errorCode: "blocked_validation", modelRunId,
        statePatch: { validation_errors: parsed.errors.slice(0, 10) },
      });
      return done({ outcome: "blocked_validation", nextStep: null, terminal: "failed", errorCode: "blocked_validation", modelRunId });
    }

    await finishRun(input.adminClient, modelRunId, {
      status: "succeeded", outcome: "ok", errorCode: null, httpStatus: 200,
      requestId: result.requestId, durationMs: result.durationMs, retryCount: result.retryCount,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    });

    const contentText = renderDocumentText(parsed.document.blocks, contact);
    const outputHash = await sha256Hex(contentText);
    const ok = await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: "quality_check",
      contentText,
      blocks: parsed.document.blocks,
      claims: parsed.document.claims,
      outputHash,
      modelRunId,
    });
    if (!ok.ok) {
      return done({ outcome: "provider_error", nextStep: null, terminal: null, errorCode: "database_error", modelRunId });
    }
    return done({ outcome: "ok", nextStep: "quality_check", terminal: null, errorCode: null, modelRunId });
  }

  // ----------------------------------------------------------- quality_check
  if (input.step === "quality_check" || input.step === "rewrite_validation") {
    const quality = checkCvQuality(buildQualityInput(doc.blocks) as never);
    const outputHash = await sha256Hex(doc.contentText ?? "");
    const needsRewrite =
      input.step === "quality_check" && !quality.ok && input.rewriteCount < MAX_REWRITES;
    const next: GenerationStep = needsRewrite ? "quality_rewrite" : "hallucination_guard";
    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: next,
      outputHash,
      quality: {
        quality_version: QUALITY_VERSION,
        ok: quality.ok,
        total_critical: quality.total_critical,
        total_important: quality.total_important,
        total_minor: quality.total_minor,
        summary_issues: quality.summary_issues,
        role_issues: quality.role_issues,
        checked_output_hash: outputHash,
        step: input.step,
      },
    });
    return done({ outcome: quality.ok ? "ok" : "needs_review", nextStep: next, terminal: null, errorCode: null, modelRunId: null });
  }

  // --------------------------------------------------------- quality_rewrite
  if (input.step === "quality_rewrite") {
    if (input.rewriteCount >= MAX_REWRITES) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: "hallucination_guard",
      });
      return done({ outcome: "ok", nextStep: "hallucination_guard", terminal: null, errorCode: null, modelRunId: null });
    }
    const p = await loadProfile(input.adminClient, TASK_REWRITE);
    if (!p.ok) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: null, terminal: "failed", errorCode: "server_misconfigured",
      });
      return done({ outcome: "configuration_error", nextStep: null, terminal: "failed", errorCode: "server_misconfigured", modelRunId: null });
    }

    const quality = checkCvQuality(buildQualityInput(doc.blocks) as never);
    const failing = new Map<string, RewriteRequest>();
    const expBlocks = doc.blocks.filter((b) => b.section === "experience");
    quality.role_issues.forEach((r) => {
      const block = expBlocks[r.role_index];
      if (!block) return;
      const issues = r.description_issues.filter((i) => i.severity === "critical" || i.severity === "important");
      if (issues.length === 0) return;
      failing.set(block.blockId, {
        original_text: block.text,
        issues,
        language: "no",
        context: "role_description",
        supporting_atom_ids: block.supportingAtomIds,
        source_claims: doc.claims.filter((c) => c.blockId === block.blockId).map((c) => c.value),
        preserve_facts: true,
      });
    });
    const summaryBlock = doc.blocks.find((b) => b.section === "summary");
    const summaryIssues = quality.summary_issues.filter((i) => i.severity === "critical" || i.severity === "important");
    if (summaryBlock && summaryIssues.length > 0) {
      failing.set(summaryBlock.blockId, {
        original_text: summaryBlock.text,
        issues: summaryIssues,
        language: "no",
        context: "summary",
        supporting_atom_ids: summaryBlock.supportingAtomIds,
        source_claims: doc.claims.filter((c) => c.blockId === summaryBlock.blockId).map((c) => c.value),
        preserve_facts: true,
      });
    }

    if (failing.size === 0) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: "hallucination_guard",
      });
      return done({ outcome: "ok", nextStep: "hallucination_guard", terminal: null, errorCode: null, modelRunId: null });
    }

    const modelRunId = await startRun(input.adminClient, {
      correlationId: input.correlationId,
      userId: input.userId,
      taskKey: TASK_REWRITE,
      profile: p.profile,
      extra: { step: input.step, blocks: failing.size },
    });
    if (!modelRunId) {
      return done({ outcome: "provider_error", nextStep: null, terminal: null, errorCode: "database_error", modelRunId: null });
    }

    const rewritten = new Map<string, string>();
    const rejected: { blockId: string; reason: string[] }[] = [];
    let inTokens = 0;
    let outTokens = 0;

    for (const [blockId, req] of failing) {
      const res = await callClaude({
        profile: p.profile,
        system: REWRITE_SYSTEM_PROMPT_NO,
        messages: [{ role: "user", content: buildRewriteUserPrompt(req) }],
        correlationId: input.correlationId,
        timeoutMs: 90_000,
        maxRetries: 1,
        runtime: { apiKey: input.anthropicApiKey },
      });
      if (!res.ok) {
        rejected.push({ blockId, reason: [res.errorCode] });
        continue;
      }
      inTokens += res.usage.inputTokens ?? 0;
      outTokens += res.usage.outputTokens ?? 0;
      let parsedRes: RewriteResponse | null = null;
      try {
        const cleaned = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
        parsedRes = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
      } catch {
        parsedRes = null;
      }
      if (!parsedRes || typeof parsedRes.rewritten_text !== "string") {
        rejected.push({ blockId, reason: ["invalid_output"] });
        continue;
      }
      const check = validateRewriteResponse(req, {
        ...parsedRes,
        supporting_atom_ids: parsedRes.supporting_atom_ids ?? req.supporting_atom_ids,
        preserved_claims: parsedRes.preserved_claims ?? [],
        introduced_claims: parsedRes.introduced_claims ?? [],
        changes_made: parsedRes.changes_made ?? [],
        requires_guard: true,
      });
      if (!check.ok) {
        // Omskriving som endrer en hard claim avvises. Originalteksten beholdes.
        rejected.push({
          blockId,
          reason: [
            ...check.missing_hard_tokens.map(() => "missing_hard_token"),
            ...check.introduced_hard_tokens.map(() => "introduced_hard_token"),
            ...check.missing_required_claims.map(() => "missing_claim"),
            ...check.invalid_atom_ids.map(() => "invalid_atom_id"),
          ],
        });
        continue;
      }
      rewritten.set(blockId, parsedRes.rewritten_text.trim());
    }

    await finishRun(input.adminClient, modelRunId, {
      status: "succeeded", outcome: rewritten.size > 0 ? "ok" : "needs_review",
      errorCode: null, httpStatus: 200, requestId: null, durationMs: Date.now() - startedAt,
      retryCount: 0, inputTokens: inTokens, outputTokens: outTokens,
    });

    if (rewritten.size === 0) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step,
        nextStep: "hallucination_guard",
        modelRunId,
        statePatch: { rewrite_rejected: rejected },
      });
      return done({ outcome: "needs_review", nextStep: "hallucination_guard", terminal: null, errorCode: null, modelRunId });
    }

    // Endret tekst = ny dokumentversjon. Tidligere kontroller gjenbrukes aldri.
    const newBlocks = doc.blocks.map((b) =>
      rewritten.has(b.blockId) ? { ...b, text: rewritten.get(b.blockId)! } : b,
    );
    const contentText = renderDocumentText(newBlocks, contact);
    const outputHash = await sha256Hex(contentText);
    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: "rewrite_validation",
      newVersion: true,
      contentText,
      blocks: newBlocks,
      claims: doc.claims,
      outputHash,
      modelRunId,
      quality: null,
      guard: null,
      statePatch: { rewrite_rejected: rejected, rewritten_blocks: [...rewritten.keys()] },
    });
    return done({ outcome: "ok", nextStep: "rewrite_validation", terminal: null, errorCode: null, modelRunId });
  }

  // ------------------------------------------------------ hallucination_guard
  if (input.step === "hallucination_guard") {
    const p = await loadProfile(input.adminClient, TASK_JUDGE);
    if (!p.ok) {
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step, nextStep: null, terminal: "failed", errorCode: "server_misconfigured",
      });
      return done({ outcome: "configuration_error", nextStep: null, terminal: "failed", errorCode: "server_misconfigured", modelRunId: null });
    }
    const modelRunId = await startRun(input.adminClient, {
      correlationId: input.correlationId,
      userId: input.userId,
      taskKey: TASK_JUDGE,
      profile: p.profile,
      extra: { step: input.step, snapshot_hash: snapshotHash },
    });

    let judgeCalls = 0;
    let inTokens = 0;
    let outTokens = 0;
    const judgeClient = {
      judge: async (jinput: LlmJudgeInput): Promise<LlmJudgeResponse> => {
        judgeCalls += 1;
        const res = await callClaude({
          profile: p.profile,
          system: LLM_JUDGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildLlmJudgePrompt(jinput) }],
          correlationId: input.correlationId,
          timeoutMs: 60_000,
          maxRetries: 1,
          runtime: { apiKey: input.anthropicApiKey },
        });
        if (!res.ok) throw new Error(res.errorCode);
        inTokens += res.usage.inputTokens ?? 0;
        outTokens += res.usage.outputTokens ?? 0;
        return parseLlmJudgeResponse(res.text);
      },
    };

    const text = doc.contentText ?? doc.blocks.map((b) => b.text).join("\n");
    const guard = await verifyAgainstAtomsFull(text, vendorAtoms, judgeClient, { language: "no" });

    if (modelRunId) {
      await finishRun(input.adminClient, modelRunId, {
        status: "succeeded", outcome: guard.ok ? "ok" : "blocked_guard", errorCode: null,
        httpStatus: 200, requestId: null, durationMs: Date.now() - startedAt, retryCount: 0,
        inputTokens: inTokens, outputTokens: outTokens,
      });
    }

    // Ingen claim kan vise til atom utenfor snapshotet.
    const outsideSnapshot = guard.matches
      .flatMap((m) => m.supporting_atom_ids)
      .filter((id) => !allowedAtomIds.has(id));

    const verdictFor = (value: string): GeneratedClaim["verification"] => {
      const match = guard.matches.find((m) => value.includes(m.claim.text) || m.claim.text.includes(value));
      if (!match) return "not_applicable";
      if (match.verdict === "verified") return "supported";
      if (match.verdict === "partial") return "partially_supported";
      return "unsupported";
    };
    const claims = doc.claims.map((c) => ({ ...c, verification: verdictFor(c.value) }));

    const outputHash = await sha256Hex(text);
    const guardPayload = {
      guard_version: GUARD_VERSION,
      ok: guard.ok && outsideSnapshot.length === 0,
      mode: guard.mode,
      stats: guard.stats,
      contradicted: guard.contradicted,
      unverified: guard.unverified,
      partial: guard.partial,
      warnings: guard.warnings,
      evidence_scope: guard.evidence_scope,
      judge_calls: judgeCalls,
      checked_output_hash: outputHash,
      snapshot_hash: snapshotHash,
    };

    if (!guard.ok || outsideSnapshot.length > 0) {
      // blocked_guard stopper kjeden. Ingen automatisk ny rewrite.
      await commitStep(input.adminClient, input.jobId, input.workerId, {
        step: input.step,
        nextStep: null,
        claims,
        outputHash,
        guard: guardPayload,
        modelRunId: modelRunId ?? null,
        terminal: "failed",
        errorCode: "blocked_guard",
      });
      return done({ outcome: "blocked_guard", nextStep: null, terminal: "failed", errorCode: "blocked_guard", modelRunId: modelRunId ?? null });
    }

    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: "ats_format_check",
      claims,
      outputHash,
      guard: guardPayload,
      modelRunId: modelRunId ?? null,
    });
    return done({ outcome: "ok", nextStep: "ats_format_check", terminal: null, errorCode: null, modelRunId: modelRunId ?? null });
  }

  // --------------------------------------------------------- ats_format_check
  if (input.step === "ats_format_check") {
    const ats = validateCvDraft(buildAtsDraft(doc.blocks, contact));
    const outputHash = await sha256Hex(doc.contentText ?? "");
    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: "finalize_for_review",
      outputHash,
      ats: {
        rules_version: RULES_VERSION,
        ok: ats.ok,
        errors: ats.errors,
        warnings: ats.warnings,
        infos: ats.infos,
        checked_output_hash: outputHash,
      },
    });
    return done({ outcome: ats.ok ? "ok" : "needs_review", nextStep: "finalize_for_review", terminal: null, errorCode: null, modelRunId: null });
  }

  // ------------------------------------------------------ finalize_for_review
  if (input.step === "finalize_for_review") {
    const outputHash = await sha256Hex(doc.contentText ?? "");
    await commitStep(input.adminClient, input.jobId, input.workerId, {
      step: input.step,
      nextStep: null,
      outputHash,
      terminal: "waiting_review",
      statePatch: { finalized_at: new Date().toISOString(), state_signature: stableStringify({ outputHash }) },
    });
    return done({ outcome: "needs_review", nextStep: null, terminal: "waiting_review", errorCode: null, modelRunId: null });
  }

  return done({ outcome: "blocked_validation", nextStep: null, terminal: "failed", errorCode: "unknown_step", modelRunId: null });
}
