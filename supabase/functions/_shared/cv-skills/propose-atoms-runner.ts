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
  computeInputSignature,
  computeSegmentHashes,
  parseNormalizationOutput,
  validateAndDedupe,
  vendorValidate,
  NORMALIZATION_OUTPUT_CONTRACT_NO,
  OUTPUT_CONTRACT_VERSION,
  type CandidateInput,
} from "./atom-proposal-pipeline.ts";

const TASK_KEY = "cv_atom_language_no";
const CLAUDE_TIMEOUT_MS = 60_000;

/**
 * Harde grenser per forespørsel. Overskridelse gir 400/429, aldri modellkall.
 * Ett kall = én delbatch. Frontend deler større utvalg deterministisk og kjører
 * delbatchene etter hverandre; grensen for hele utvalget håndheves der.
 */
export const RUN_LIMITS = {
  maxCandidatesPerRequest: 20,
  maxTotalInputChars: 20_000,
  maxCandidatesPerSelection: 120,
  maxSelectionChars: 120_000,
  maxActiveRunsPerUser: 2,
  maxActiveRunsPerImport: 1,
  maxRunsPerHourPerUserTask: 12,
} as const;

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
  /** Eksplisitt brukerhandling: avviste forslag erstattes og analysen kjøres på nytt. */
  regenerate?: boolean;
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
  if (segments.length > RUN_LIMITS.maxCandidatesPerRequest) {
    return fail(400, "too_many_candidates", "For mange elementer i én analyse.", {
      limit: RUN_LIMITS.maxCandidatesPerRequest,
      received: segments.length,
    });
  }
  const totalChars = segments.reduce((n, s) => n + s.text.length, 0);
  if (totalChars > RUN_LIMITS.maxTotalInputChars) {
    return fail(400, "input_too_large", "Kildeteksten er for stor for én analyse.", {
      limit: RUN_LIMITS.maxTotalInputChars,
      received: totalChars,
    });
  }

  const segmentHashes = await computeSegmentHashes(segments);
  const inputSignature = await computeInputSignature(
    cvImportId,
    segments,
    NORMALIZATION_PROMPT_VERSION,
    NORMALIZER_VERSION,
  );

  // -------------------------------------------------------- idempotens
  const { data: existingBatch } = await userClient
    .from("atom_enrichment_batches")
    .select("id")
    .eq("user_id", userId)
    .eq("source_table", "cv_parse_candidates")
    .eq("source_id", cvImportId)
    .eq("input_signature", inputSignature)
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
        input_signature: inputSignature,
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

  // --------------------------------------------------------- kjøregrenser
  const { data: limitJson, error: limitError } = await adminClient.rpc(
    "internal_ai_check_run_limits",
    {
      p_user_id: userId,
      p_task_key: TASK_KEY,
      p_import_id: cvImportId,
      p_max_active_per_user: RUN_LIMITS.maxActiveRunsPerUser,
      p_max_active_per_import: RUN_LIMITS.maxActiveRunsPerImport,
      p_max_per_hour: RUN_LIMITS.maxRunsPerHourPerUserTask,
    },
  );
  if (limitError) {
    return fail(500, "database_error", "Kunne ikke kontrollere kjøregrensene.");
  }
  const limits = (limitJson ?? {}) as { allowed?: boolean; reason?: string };
  if (limits.allowed !== true) {
    return fail(429, limits.reason ?? "rate_limited", "Analysen er midlertidig sperret.", {
      limits: limitJson,
    });
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
    // Svarkontrakten er en del av prompten og må derfor spores i versjonen.
    promptVersion: `${pj.prompt_version}+out${OUTPUT_CONTRACT_VERSION}`,
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
      input_signature: inputSignature,
      normalizer_version: NORMALIZER_VERSION,
      cv_import_id: cvImportId,
      segments: segments.length,
    },
    p_api_version: "2023-06-01",
  });
  if (runError || typeof modelRunId !== "string") {
    console.error(
      "[propose-cv-atoms] start_model_run",
      runError?.message ?? `uventet retur: ${typeof modelRunId}`,
    );
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
    system: `${NORMALIZATION_SYSTEM_PROMPT_NO}\n\n${NORMALIZATION_OUTPUT_CONTRACT_NO}`,
    messages: [
      {
        role: "user",
        content: buildNormalizationUserPrompt({
          source_type: "cv_parse_candidates",
          source_id: cvImportId,
          source_hash: inputSignature,
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

  const batch = { ...parsedOut.batch, source_id: cvImportId, source_hash: inputSignature };
  const vendorCheck = vendorValidate(batch);
  const { kept, dropped } = validateAndDedupe(batch, segments, {
    cvImportId,
    segmentHashes,
    inputSignature,
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
  // Batch og alle forslag skrives i én transaksjon (RPC). Feiler ett forslag,
  // rulles hele settet tilbake og ingen batch blir liggende igjen.
  const { data: writeJson, error: writeError } = await adminClient.rpc(
    "internal_ai_create_enrichment_batch",
    {
      p_user_id: userId,
      p_batch: {
        source_type: "cv_import",
        source_table: "cv_parse_candidates",
        source_id: cvImportId,
        source_record_id: cvImportId,
        source_hash: inputSignature,
        input_signature: inputSignature,
        normalizer_version: NORMALIZER_VERSION,
        model_run_id: modelRunId,
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
      },
      p_proposals: kept,
    },
  );

  if (writeError || !writeJson) {
    console.error(
      "[propose-cv-atoms] atomic write failed",
      JSON.stringify({ correlationId, code: writeError?.code ?? null }),
    );
    await finishRun({
      status: "failed",
      outcome: "invalid_output",
      errorCode: "database_error",
      httpStatus: 200,
      requestId: result.requestId,
      durationMs: result.durationMs,
      retryCount: result.retryCount,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return fail(500, "database_error", "Kunne ikke lagre forslagene.");
  }

  const write = writeJson as {
    batch_id: string;
    idempotent: boolean;
    inserted: number;
    skipped: number;
  };

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

  const { data: storedRows } = await adminClient
    .from("atom_enrichment_proposals")
    .select("id, source_record_id, source_hash, proposal_action, proposal_payload")
    .eq("batch_id", write.batch_id);

  const rows = (storedRows ?? []) as {
    id: string;
    source_record_id: string | null;
    source_hash: string | null;
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
      inserted: write.inserted,
      skipped: write.skipped,
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
      input_signature: inputSignature,
      batch_id: write.batch_id,
      model_run_id: modelRunId,
      model_profile: {
        profile_key: pj.profile_key,
        model_id: profile.modelId,
        prompt_version: profile.promptVersion,
        max_tokens: profile.maxTokens,
      },
      segments: segments.length,
      proposals_created: write.inserted,
      proposals_skipped: write.skipped,
      proposals: rows.map((r) => ({
        id: r.id,
        proposal_action: r.proposal_action,
        cv_import_id: cvImportId,
        cv_parse_candidate_id: r.source_record_id,
        source_hash: r.source_hash,
        normalizer_version: NORMALIZER_VERSION,
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
