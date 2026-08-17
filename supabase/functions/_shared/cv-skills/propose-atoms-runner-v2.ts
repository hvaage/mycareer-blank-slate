// Serverkjøring for /api/cv/propose-cv-atoms med cv-atom-language-no v2.1.0.
//
// Oppgraderingen er rollebevisst: modellen får kildespenn og deterministisk
// utledede rolleblokker, ikke løsrevne tekstsegmenter. Samme arbeidsgiver er
// aldri det samme som samme rolle.
//
// Modulen skriver KUN til atom_enrichment_batches og atom_enrichment_proposals.

import { callClaude, type ModelProfile } from "../claude/client.ts";
import {
  ATOMIZATION_OUTPUT_CONTRACT_NO,
  ATOMIZATION_OUTPUT_CONTRACT_VERSION,
  ATOMIZATION_SYSTEM_PROMPT_NO,
  buildAtomizationUserPrompt,
} from "./vendor/cv-atom-language-no/v2/prompt.ts";
import {
  buildAtomizationInput,
  narrowInputToCandidates,
  PREPARSER_VERSION,
  type PreparserCandidate,
} from "./role-block-preparser.ts";
import {
  applyQualityGates,
  buildProposalRows,
  hydrateEvidence,
  parseAtomizationOutput,
} from "./atom-proposal-pipeline-v2.ts";
import { canonicalizeSourceText, computeSourceHash } from "./atom-proposal-pipeline.ts";

export const TASK_KEY_V2 = "cv_atom_language_no_v2_1";
// Rollebevisst analyse av en hel import er et tungt kall. Delbatcher fra
// frontend er normalt langt mindre enn dette taket.
const CLAUDE_TIMEOUT_MS = 240_000;

export const RUN_LIMITS_V2 = {
  maxCandidatesPerRequest: 80,
  maxTotalInputChars: 60_000,
  maxActiveRunsPerUser: 2,
  maxActiveRunsPerImport: 1,
  maxRunsPerHourPerUserTask: 12,
} as const;

export type RunnerV2Input = {
  userClient: any;
  adminClient: any;
  anthropicApiKey: string;
  userId: string;
  cvImportId: string;
  /** Alle kandidater i importen — konteksten rolleblokkene bygges av. */
  allCandidates: PreparserCandidate[];
  /** Utvalget som skal analyseres i denne delbatchen. */
  selectedRefs: string[];
  correlationId: string;
  startedAt: number;
  regenerate?: boolean;
  /** Evaluering: kjør modellen uten å skrive forslag. */
  dryRun?: boolean;
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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runProposeCvAtomsV2(input: RunnerV2Input): Promise<RunnerResult> {
  const { userClient, adminClient, userId, cvImportId, correlationId, startedAt } = input;

  const sorted = [...input.allCandidates].sort((a, b) =>
    a.local_ref === b.local_ref
      ? a.id.localeCompare(b.id)
      : a.local_ref.localeCompare(b.local_ref, "nb-NO"),
  );
  const fullInput = buildAtomizationInput(sorted);
  const modelInput = narrowInputToCandidates(fullInput, input.selectedRefs);

  if (modelInput.sourceSpans.length === 0) {
    return fail(400, "no_candidates", "Ingen kandidater til analyse i denne importen.");
  }
  if (modelInput.sourceSpans.length > RUN_LIMITS_V2.maxCandidatesPerRequest) {
    return fail(400, "too_many_candidates", "For mange elementer i én analyse.", {
      limit: RUN_LIMITS_V2.maxCandidatesPerRequest,
    });
  }
  const totalChars = modelInput.sourceSpans.reduce((n, s) => n + s.text.length, 0);
  if (totalChars > RUN_LIMITS_V2.maxTotalInputChars) {
    return fail(400, "input_too_large", "Kildeteksten er for stor for én analyse.", {
      limit: RUN_LIMITS_V2.maxTotalInputChars,
    });
  }

  // Kildehasher per kildespenn, brukt både til idempotens og per forslag.
  const spanHashes = new Map<string, string>();
  const spanTexts = new Map<string, string>();
  for (const span of modelInput.sourceSpans) {
    spanTexts.set(span.id, span.text);
    spanHashes.set(span.id, await computeSourceHash(span.text));
  }
  const candidatesByRef = new Map(sorted.map((c) => [c.local_ref, c]));

  let regenerationEpoch = 0;
  if (input.regenerate === true && input.dryRun !== true) {
    const { data: regenJson, error: regenError } = await adminClient.rpc(
      "internal_ai_begin_regeneration",
      { p_user_id: userId, p_import_id: cvImportId },
    );
    if (regenError) return fail(500, "database_error", "Kunne ikke starte en ny analyse.");
    regenerationEpoch = Number((regenJson as { epoch?: number } | null)?.epoch ?? 0);
  }

  const inputSignature = await sha256Hex(
    JSON.stringify({
      v: "v2.1",
      cv_import_id: cvImportId,
      prompt_version: `2.1.0+out${ATOMIZATION_OUTPUT_CONTRACT_VERSION}`,
      preparser_version: PREPARSER_VERSION,
      regeneration_epoch: regenerationEpoch,
      spans: modelInput.sourceSpans.map((s) => ({
        id: s.id,
        h: spanHashes.get(s.id),
        t: canonicalizeSourceText(s.text).length,
      })),
      role_blocks: modelInput.roleBlocks.map((b) => ({
        id: b.id,
        g: b.employmentGroupKey,
        h: b.appointmentHints,
      })),
    }),
  );

  if (input.dryRun !== true) {
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
          skill_version: "2.1.0",
          cv_import_id: cvImportId,
          input_signature: inputSignature,
          batch_id: existingBatch.id,
          proposals_created: 0,
          proposals_existing: count ?? 0,
          model_called: false,
          career_atoms_written: 0,
          note: "Samme kildesignatur er allerede analysert. Ingen nye forslag ble laget.",
          duration_ms: Date.now() - startedAt,
        },
      };
    }

    const { data: limitJson, error: limitError } = await adminClient.rpc(
      "internal_ai_check_run_limits",
      {
        p_user_id: userId,
        p_task_key: TASK_KEY_V2,
        p_import_id: cvImportId,
        p_max_active_per_user: RUN_LIMITS_V2.maxActiveRunsPerUser,
        p_max_active_per_import: RUN_LIMITS_V2.maxActiveRunsPerImport,
        p_max_per_hour: RUN_LIMITS_V2.maxRunsPerHourPerUserTask,
      },
    );
    if (limitError) return fail(500, "database_error", "Kunne ikke kontrollere kjøregrensene.");
    const limits = (limitJson ?? {}) as { allowed?: boolean; reason?: string };
    if (limits.allowed !== true) {
      return fail(429, limits.reason ?? "rate_limited", "Analysen er midlertidig sperret.");
    }
  }

  const { data: profileJson, error: profileError } = await adminClient.rpc(
    "internal_ai_get_active_profile",
    { p_task_key: TASK_KEY_V2 },
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
    taskKey: TASK_KEY_V2,
    modelId: pj.model_id,
    promptVersion: `${pj.prompt_version}+out${ATOMIZATION_OUTPUT_CONTRACT_VERSION}`,
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

  const { data: modelRunId, error: runError } = await adminClient.rpc(
    "internal_ai_start_model_run",
    {
      p_correlation_id: correlationId,
      p_user_id: userId,
      p_task_key: TASK_KEY_V2,
      p_model_id: profile.modelId,
      p_profile_id: profile.profileId,
      p_profile_snapshot: {
        profile_key: pj.profile_key,
        prompt_version: profile.promptVersion,
        max_tokens: profile.maxTokens,
        request_options: profile.requestOptions,
        capabilities: pj.capabilities ?? {},
        input_signature: inputSignature,
        preparser_version: PREPARSER_VERSION,
        cv_import_id: cvImportId,
        spans: modelInput.sourceSpans.length,
        role_blocks: modelInput.roleBlocks.length,
        dry_run: input.dryRun === true,
      },
      p_api_version: "2023-06-01",
    },
  );
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

  const result = await callClaude({
    profile,
    system: `${ATOMIZATION_SYSTEM_PROMPT_NO}\n\n${ATOMIZATION_OUTPUT_CONTRACT_NO}`,
    messages: [{ role: "user", content: buildAtomizationUserPrompt(modelInput) }],
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
    if (isConfig) {
      return fail(500, "configuration_error", "Modelloppsettet er ikke gyldig.");
    }
    return fail(
      result.outcome === "timeout" ? 504 : 502,
      result.outcome === "timeout" ? "provider_timeout" : "provider_error",
      "Analysen kunne ikke fullføres. Ingen forslag ble lagret.",
    );
  }

  const parsed = parseAtomizationOutput(result.text);
  if (!parsed.ok) {
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
      validation_errors: parsed.errors.slice(0, 10),
    });
  }

  // Sitatene hydreres fra frosset input før portene kjører.
  const gated = applyQualityGates(hydrateEvidence(parsed.output, modelInput), modelInput);
  const { kept, dropped } = buildProposalRows(gated.output, {
    cvImportId,
    inputSignature,
    modelRunId,
    promptVersion: profile.promptVersion,
    normalizerVersion: PREPARSER_VERSION,
    candidatesByRef,
    spanHashes,
    spanTexts,
  });

  const usage = {
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    duration_ms: result.durationMs,
  };

  if (input.dryRun === true) {
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
    return {
      status: 200,
      body: {
        ok: true,
        dry_run: true,
        skill_version: "2.1.0",
        model_run_id: modelRunId,
        input_signature: inputSignature,
        role_blocks: modelInput.roleBlocks.length,
        output: gated.output,
        quality_gates: gated.report,
        proposals_would_create: kept.length,
        dropped,
        usage,
      },
    };
  }

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
    return fail(422, "blocked_validation", "Ingen forslag besto evidenskontrollen.", { dropped });
  }

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
        normalizer_version: PREPARSER_VERSION,
        model_run_id: modelRunId,
        title: "Rollebevisst analyse av CV-import",
        status: "open",
        context: {
          task_key: TASK_KEY_V2,
          skill_version: "2.1.0",
          model_run_id: modelRunId,
          model_id: profile.modelId,
          prompt_version: profile.promptVersion,
          preparser_version: PREPARSER_VERSION,
          correlation_id: correlationId,
          spans: modelInput.sourceSpans.length,
          role_blocks: modelInput.roleBlocks.length,
          quality_gates: gated.report,
          issues: gated.output.issues.slice(0, 20),
          dropped,
        },
      },
      p_proposals: kept,
    },
  );

  if (writeError || !writeJson) {
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

  const write = writeJson as { batch_id: string; inserted: number; skipped: number };

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

  return {
    status: 200,
    body: {
      ok: true,
      skill_version: "2.1.0",
      cv_import_id: cvImportId,
      input_signature: inputSignature,
      batch_id: write.batch_id,
      model_run_id: modelRunId,
      model_profile: {
        profile_key: pj.profile_key,
        model_id: profile.modelId,
        prompt_version: profile.promptVersion,
      },
      role_blocks: modelInput.roleBlocks.length,
      roles_proposed: gated.output.roles.length,
      achievements_proposed: gated.output.achievements.length,
      skills_proposed: gated.output.skills.length,
      proposals_created: write.inserted,
      proposals_skipped: write.skipped,
      quality_gates: gated.report,
      dropped,
      career_atoms_written: 0,
      usage,
      note: "Forslagene venter på gjennomgang. Ingenting er skrevet til karriereoversikten.",
      duration_ms: Date.now() - startedAt,
    },
  };
}
