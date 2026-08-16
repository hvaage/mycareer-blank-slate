// Serverkjøring for /api/cv/propose-cv-atoms.
//
// Denne modulen holder all modell- og leverandørlogikk utenfor src/, slik at
// hverken Claude-klienten, vendorkoden eller ANTHROPIC_API_KEY kan havne i
// klientbunten. Ruten laster modulen dynamisk inne i handleren.
//
// Modulen skriver KUN til atom_enrichment_batches og atom_enrichment_proposals.
// career_atoms er urørt: brukerens gjennomgang og v4-apply er eneste vei dit.

import { callClaude, type ModelProfile } from "../claude/client.ts";
import {
  NORMALIZATION_SYSTEM_PROMPT_NO,
  NORMALIZATION_PROMPT_VERSION,
  buildNormalizationUserPrompt,
} from "./vendor/cv-atom-language-no/scripts/prompt.ts";
import { NORMALIZER_VERSION } from "./vendor/cv-atom-language-no/scripts/normalizer.ts";
import {
  buildSegments,
  computeSourceHash,
  parseNormalizationOutput,
  validateAndDedupe,
  vendorValidate,
  type CandidateInput,
} from "./atom-proposal-pipeline.ts";

const TASK_KEY = "cv_atom_language_no";
const CLAUDE_TIMEOUT_MS = 60_000;

export type RunnerInput = {
  /** Brukerens egen klient (RLS) — brukes til idempotens-oppslag. */
  userClient: any;
  /** Service-role-klient — brukes først etter at eierskap er verifisert. */
  adminClient: any;
  /** API-nøkkel injiseres her; Claude-klienten leser aldri env selv. */
  anthropicApiKey: string;
  userId: string;
  cvImportId: string;
  candidates: CandidateInput[];
  correlationId: string;
  startedAt: number;
};

export type RunnerResult = { status: number; body: Record<string, unknown> };

function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): RunnerResult {
  return { status, body: { ok: false, error: { code, message }, ...extra } };
}

export async function runProposeCvAtoms(input: RunnerInput): Promise<RunnerResult> {
  const { userClient, adminClient, userId, cvImportId, correlationId, startedAt } = input;

  const segments = buildSegments(input.candidates);
  if (segments.length === 0) {
    return fail(400, "no_candidates", "Ingen kandidater til normalisering i denne importen.");
  }

  const sourceHash = await computeSourceHash(cvImportId, segments, NORMALIZATION_PROMPT_VERSION);

  // -------------------------------------------------------- idempotens
  const { data: existingBatch } = await userClient
    .from("atom_enrichment_batches")
    .select("id")
    .eq("user_id", userId)
    .eq("source_table", "cv_parse_candidates")
    .eq("source_id", cvImportId)
    .eq("source_hash", sourceHash)
    .maybeSingle();

  if (existingBatch) {
    const { count } = await userClient
      .from("atom_enrichment_proposals")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", existingBatch.id);
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: true,
        cv_import_id: cvImportId,
        source_hash: sourceHash,
        batch_id: existingBatch.id,
        proposals_created: 0,
        proposals_existing: count ?? 0,
        model_called: false,
        career_atoms_written: 0,
        note: "Samme kildesignatur er allerede normalisert. Ingen nye forslag ble laget.",
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  // ---------------------------------------------------- modellprofil
  const { data: profileJson, error: profileError } = await adminClient.rpc(
    "internal_ai_get_active_profile",
    { p_task_key: TASK_KEY },
  );
  if (profileError || !profileJson) {
    return fail(500, "server_misconfigured", "Modellprofilen mangler.");
  }
  const pj = profileJson as {
    profile_id: string;
    profile_key: string;
    model_id: string;
    prompt_version: string;
    max_tokens: number;
    request_options: Record<string, unknown>;
    capabilities: Record<string, boolean>;
  };
  const profile: ModelProfile = {
    profileId: pj.profile_id,
    taskKey: TASK_KEY,
    modelId: pj.model_id,
    promptVersion: pj.prompt_version,
    maxTokens: pj.max_tokens,
    requestOptions: pj.request_options ?? {},
    capabilities: {
      supportsTemperature: pj.capabilities?.["supportsTemperature"] === true,
      supportsTopP: pj.capabilities?.["supportsTopP"] === true,
      supportsTopK: pj.capabilities?.["supportsTopK"] === true,
      supportsThinking: pj.capabilities?.["supportsThinking"] === true,
      supportsPrefill: pj.capabilities?.["supportsPrefill"] === true,
    },
  };

  const { data: modelRunId, error: runError } = await adminClient.rpc("internal_ai_start_model_run", {
    p_correlation_id: correlationId,
    p_user_id: userId,
    p_task_key: TASK_KEY,
    p_model_id: profile.modelId,
    p_profile_id: profile.profileId,
    p_profile_snapshot: {
      profile_key: pj.profile_key,
      prompt_version: profile.promptVersion,
      max_tokens: profile.maxTokens,
      request_options: profile.requestOptions,
      capabilities: pj.capabilities ?? {},
      source_hash: sourceHash,
      cv_import_id: cvImportId,
      segments: segments.length,
    },
    p_api_version: "2023-06-01",
  });
  if (runError || typeof modelRunId !== "string") {
    return fail(500, "database_error", "Kunne ikke starte modellkjøringen.");
  }

  const finishRun = async (r: {
    status: "succeeded" | "failed" | "configuration_error";
    outcome: string | null;
    errorCode: string | null;
    httpStatus: number | null;
    requestId: string | null;
    durationMs: number;
    retryCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }) => {
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
  };

  // --------------------------------------------------------- modellkall
  const result = await callClaude({
    profile,
    system: NORMALIZATION_SYSTEM_PROMPT_NO,
    messages: [
      {
        role: "user",
        content: buildNormalizationUserPrompt({
          source_type: "cv_parse_candidates",
          source_id: cvImportId,
          source_hash: sourceHash,
          segments: segments.map((s) => ({ id: s.id, text: s.text })),
        }),
      },
    ],
    correlationId,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    maxRetries: 1,
    runtime: { apiKey: input.anthropicApiKey },
  });

  if (!result.ok) {
    const isConfig = result.outcome === "configuration_error";
    await finishRun({
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
    console.error(
      "[propose-cv-atoms] model step failed",
      JSON.stringify({ correlationId, outcome: result.outcome, errorCode: result.errorCode }),
    );
    if (isConfig) {
      return fail(500, "configuration_error", "Modelloppsettet er ikke gyldig.", {
        model_run_id: modelRunId,
        proposals_created: 0,
      });
    }
    return fail(
      result.outcome === "timeout" ? 504 : 502,
      result.outcome === "timeout" ? "provider_timeout" : "provider_error",
      "Analysen kunne ikke fullføres. Ingen forslag ble lagret.",
      { model_run_id: modelRunId, proposals_created: 0 },
    );
  }

  // ---------------------------------------------------- validering
  const parsedOut = parseNormalizationOutput(result.text);
  if (!parsedOut.ok) {
    await finishRun({
      status: "failed",
      outcome: "invalid_output",
      errorCode: "blocked_validation",
      httpStatus: 200,
      requestId: result.requestId,
      durationMs: result.durationMs,
      retryCount: result.retryCount,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return fail(422, "blocked_validation", "Svaret fra modellen var ikke gyldig.", {
      model_run_id: modelRunId,
      proposals_created: 0,
      validation_errors: parsedOut.errors.slice(0, 10),
    });
  }

  const batch = { ...parsedOut.batch, source_id: cvImportId, source_hash: sourceHash };
  const vendorCheck = vendorValidate(batch);
  const { kept, dropped } = validateAndDedupe(batch, segments, {
    cvImportId,
    sourceHash,
    modelRunId,
    promptVersion: profile.promptVersion,
    normalizerVersion: NORMALIZER_VERSION,
  });

  if (kept.length === 0) {
    await finishRun({
      status: "failed",
      outcome: "invalid_output",
      errorCode: "blocked_validation",
      httpStatus: 200,
      requestId: result.requestId,
      durationMs: result.durationMs,
      retryCount: result.retryCount,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return fail(422, "blocked_validation", "Ingen forslag besto evidenskontrollen.", {
      model_run_id: modelRunId,
      proposals_created: 0,
      dropped,
      vendor_errors: vendorCheck.errors.slice(0, 10),
    });
  }

  // -------------------------------------------------------- skriving
  const { data: batchRow, error: batchError } = await adminClient
    .from("atom_enrichment_batches")
    .insert({
      user_id: userId,
      source_type: "cv_import",
      source_table: "cv_parse_candidates",
      source_id: cvImportId,
      source_record_id: cvImportId,
      source_hash: sourceHash,
      title: "Språknormalisering av CV-import",
      status: "open",
      context: {
        task_key: TASK_KEY,
        model_run_id: modelRunId,
        model_id: profile.modelId,
        prompt_version: profile.promptVersion,
        normalizer_version: NORMALIZER_VERSION,
        correlation_id: correlationId,
        segments: segments.length,
        dropped,
        vendor_warnings: vendorCheck.warnings.slice(0, 20),
      },
    })
    .select("id")
    .single();
  if (batchError || !batchRow) {
    return fail(500, "database_error", "Kunne ikke lagre forslagene.");
  }

  const { data: insertedRows, error: proposalError } = await adminClient
    .from("atom_enrichment_proposals")
    .insert(
      kept.map((p) => ({
        batch_id: batchRow.id,
        user_id: userId,
        proposal_action: p.proposal_action,
        target_atom_type: p.target_atom_type,
        source_type: p.source_type,
        source_table: p.source_table,
        source_record_id: p.source_record_id,
        source_id: p.source_id,
        source_hash: p.source_hash,
        confidence: p.confidence,
        inferred: p.inferred,
        rationale: p.rationale,
        explanation: p.explanation,
        status: "pending_review",
        proposal_payload: p.proposal_payload,
      })),
    )
    .select("id, source_record_id, proposal_action, proposal_payload");
  if (proposalError) {
    console.error(
      "[propose-cv-atoms] proposal insert failed",
      JSON.stringify({ correlationId, code: proposalError.code }),
    );
    return fail(500, "database_error", "Kunne ikke lagre forslagene.");
  }

  await finishRun({
    status: "succeeded",
    outcome: "ok",
    errorCode: null,
    httpStatus: 200,
    requestId: result.requestId,
    durationMs: result.durationMs,
    retryCount: result.retryCount,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });

  const rows = (insertedRows ?? []) as {
    id: string;
    source_record_id: string | null;
    proposal_action: string;
    proposal_payload: Record<string, unknown> | null;
  }[];

  console.info(
    "[propose-cv-atoms] ok",
    JSON.stringify({
      correlationId,
      modelRunId,
      segments: segments.length,
      proposals: rows.length,
      dropped: dropped.length,
      durationMs: Date.now() - startedAt,
    }),
  );

  return {
    status: 200,
    body: {
      ok: true,
      phase: "3B",
      cv_import_id: cvImportId,
      source_hash: sourceHash,
      batch_id: batchRow.id,
      model_run_id: modelRunId,
      model_profile: {
        profile_key: pj.profile_key,
        model_id: profile.modelId,
        prompt_version: profile.promptVersion,
        max_tokens: profile.maxTokens,
      },
      segments: segments.length,
      proposals_created: rows.length,
      proposals: rows.map((r) => ({
        id: r.id,
        proposal_action: r.proposal_action,
        cv_import_id: cvImportId,
        cv_parse_candidate_id: r.source_record_id,
        source_hash: sourceHash,
        atom_type: (r.proposal_payload?.["atom_type"] as string | undefined) ?? null,
        content_no: (r.proposal_payload?.["content_no"] as string | undefined) ?? null,
        source_quote: (r.proposal_payload?.["source_quote"] as string | undefined) ?? null,
      })),
      dropped,
      career_atoms_written: 0,
      note: "Forslagene venter på gjennomgang. Ingenting er skrevet til karriereoversikten.",
      duration_ms: Date.now() - startedAt,
    },
  };
}
