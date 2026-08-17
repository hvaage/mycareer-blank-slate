// Asynkron kjøring av hierarkisk v2.1-atomisering med synlig fremdrift.
//
// En jobb består av deterministisk planlagte blokker:
//   fase 1 (appointments)  — én blokk per ansettelsesgruppe
//   fase 2 (block_content) — én blokk per rolleblokk + eventuelt øvrig innhold
//   fase 3 (consolidate)   — global kompetansekonsolidering og skriving
//
// Hvert kall til stepAtomizationJob() gjør ett kontrollert steg: inntil tre
// samtidige modellkall innenfor samme fase. Klienten kaller steget på nytt til
// jobben er terminal, og ser status per blokk underveis.
//
// Idempotens: hver blokk har sin egen delbatch-signatur, og en blokk som
// allerede er complete kjøres aldri på nytt. Ingenting skrives til career_atoms.

import type { ModelProfile } from "../claude/client.ts";
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
} from "./atom-proposal-pipeline-v2.ts";
import { canonicalizeSourceText, computeSourceHash } from "./atom-proposal-pipeline.ts";
import { buildResultLedger } from "./result-ledger-v2.ts";
import {
  reconcileReviewBasisFromV2,
  type ReconcilePlan,
  type ReconcileProposal,
} from "./review-basis-reconcile.ts";
import { ATOMIZATION_OUTPUT_CONTRACT_VERSION } from "./vendor/cv-atom-language-no/v2/prompt.ts";
import {
  DEFAULT_MAX_CONCURRENCY,
  finalizeSkills,
  HIERARCHICAL_PIPELINE_VERSION,
  mapLimit,
  planHierarchicalRun,
  runAppointmentGroupStep,
  runBlockContentStep,
  sha256Hex,
  type PhaseMetric,
  type StepContext,
} from "./hierarchical-atomization-v2.ts";
import type {
  AchievementProposal,
  AtomizationIssue,
  CvAtomizationInput,
  QualificationProposal,
  RoleAtomProposal,
  SkillProposal,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import { RUN_LIMITS_V2, TASK_KEY_V2 } from "./propose-atoms-runner-v2.ts";
import {
  applySkillEvidence,
  buildSkillEvidenceRequest,
  runSkillEvidenceStep,
  SKILL_EVIDENCE_PHASE_VERSION,
  type SkillEvidenceAssignment,
} from "./skill-evidence-v2.ts";


const CLAUDE_TIMEOUT_MS = 240_000;

export type JobBlockRow = {
  id: string;
  phase: "appointments" | "block_content" | "consolidate";
  block_key: string;
  label: string;
  sort_order: number;
  status: "queued" | "running" | "complete" | "needs_review" | "failed";
  span_ids: string[];
  result: Record<string, unknown> | null;
  metrics: Record<string, unknown>;
  error_code: string | null;
};

export type JobRunnerResult = { status: number; body: Record<string, unknown> };

function fail(status: number, code: string, message: string): JobRunnerResult {
  return { status, body: { ok: false, error: { code, message } } };
}

async function loadProfile(adminClient: any): Promise<ModelProfile | null> {
  const { data, error } = await adminClient.rpc("internal_ai_get_active_profile", {
    p_task_key: TASK_KEY_V2,
  });
  if (error || !data) return null;
  const pj = data as {
    profile_id: string;
    model_id: string;
    prompt_version: string;
    max_tokens: number;
    request_options: Record<string, unknown>;
    capabilities: Record<string, boolean>;
  };
  return {
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
}

function buildInput(
  allCandidates: PreparserCandidate[],
  selectedRefs: string[],
): { sorted: PreparserCandidate[]; modelInput: CvAtomizationInput } {
  const sorted = [...allCandidates].sort((a, b) =>
    a.local_ref === b.local_ref
      ? a.id.localeCompare(b.id)
      : a.local_ref.localeCompare(b.local_ref, "nb-NO"),
  );
  const modelInput = narrowInputToCandidates(buildAtomizationInput(sorted), selectedRefs);
  return { sorted, modelInput };
}

// ---------------------------------------------------------------------------
// Start: planlegg jobben (ingen modellkall — brukeren ser fremdrift umiddelbart)
// ---------------------------------------------------------------------------

export type StartJobInput = {
  adminClient: any;
  userId: string;
  cvImportId: string;
  allCandidates: PreparserCandidate[];
  selectedRefs: string[];
  correlationId: string;
  regenerate?: boolean;
};

export async function startAtomizationJob(args: StartJobInput): Promise<JobRunnerResult> {
  const { adminClient, userId, cvImportId } = args;
  const { modelInput } = buildInput(args.allCandidates, args.selectedRefs);

  if (modelInput.sourceSpans.length === 0) {
    return fail(400, "no_candidates", "Ingen kandidater til analyse i denne importen.");
  }
  if (modelInput.sourceSpans.length > RUN_LIMITS_V2.maxCandidatesPerRequest) {
    return fail(400, "too_many_candidates", "For mange elementer i én analyse.");
  }

  let regenerationEpoch = 0;
  if (args.regenerate === true) {
    const { data, error } = await adminClient.rpc("internal_ai_begin_regeneration", {
      p_user_id: userId,
      p_import_id: cvImportId,
    });
    if (error) return fail(500, "database_error", "Kunne ikke starte en ny analyse.");
    regenerationEpoch = Number((data as { epoch?: number } | null)?.epoch ?? 0);
  }

  const spanHashes = new Map<string, string>();
  for (const span of modelInput.sourceSpans) {
    spanHashes.set(span.id, await computeSourceHash(span.text));
  }
  const inputSignature = await sha256Hex(
    JSON.stringify({
      v: "v2.1",
      pipeline: `hier${HIERARCHICAL_PIPELINE_VERSION}`,
      cv_import_id: cvImportId,
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

  // Idempotens: samme kildesignatur gjenbruker jobben i stedet for å kjøre nytt.
  const { data: existing } = await adminClient
    .from("cv_atomization_jobs")
    .select("id, status")
    .eq("user_id", userId)
    .eq("cv_import_id", cvImportId)
    .eq("input_signature", inputSignature)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    // En avbrutt jobb startes igjen uten å kjøre ferdige blokker på nytt:
    // fullførte blokker beholder resultat og provenance, bare køen åpnes.
    if (existing.status === "cancelled") {
      await adminClient
        .from("cv_atomization_jobs")
        .update({
          status: "queued",
          error_code: null,
          attempts: 0,
          lease_owner: null,
          lease_expires_at: null,
          finished_at: null,
        })
        .eq("id", existing.id);
    }
    return { status: 200, body: { ok: true, job_id: existing.id, reused: true } };
  }


  const { data: job, error: jobError } = await adminClient
    .from("cv_atomization_jobs")
    .insert({
      user_id: userId,
      cv_import_id: cvImportId,
      status: "queued",
      phase: "appointments",
      input_signature: inputSignature,
      correlation_id: args.correlationId,
      regenerate: args.regenerate === true,
      metrics: { selected_refs: args.selectedRefs.length, spans: modelInput.sourceSpans.length },
    })
    .select("id")
    .single();
  if (jobError || !job) return fail(500, "database_error", "Kunne ikke opprette analysejobben.");

  const plan = planHierarchicalRun(modelInput);
  const rows = [
    ...plan.appointments.map((g, i) => ({
      job_id: job.id,
      user_id: userId,
      phase: "appointments",
      block_key: g.key,
      label: `Finner roller og ansettelsesforløp: ${g.label}`,
      sort_order: 100 + i,
      span_ids: g.spanIds,
    })),
    ...plan.content.map((b, i) => ({
      job_id: job.id,
      user_id: userId,
      phase: "block_content",
      block_key: b.key,
      label: `Behandler ${b.label}`,
      sort_order: 200 + i,
      span_ids: b.spanIds,
    })),
    {
      job_id: job.id,
      user_id: userId,
      phase: "skill_evidence",
      block_key: "__skill_evidence__",
      label: "Finner hvilke roller og resultater som belegger kompetansene",
      sort_order: 850,
      span_ids: [],
    },
    {

      job_id: job.id,
      user_id: userId,
      phase: "consolidate",
      block_key: "__consolidate__",
      label: "Samler kompetanser på tvers av roller",
      sort_order: 900,
      span_ids: [],
    },
  ];
  const { error: blockError } = await adminClient
    .from("cv_atomization_job_blocks")
    .insert(rows);
  if (blockError) return fail(500, "database_error", "Kunne ikke planlegge analysen.");

  return {
    status: 200,
    body: {
      ok: true,
      job_id: job.id,
      reused: false,
      input_signature: inputSignature,
      blocks: rows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Steg: kjør neste kjørbare enhet
// ---------------------------------------------------------------------------

export type StepJobInput = {
  adminClient: any;
  anthropicApiKey: string;
  userId: string;
  jobId: string;
  allCandidates: PreparserCandidate[];
  selectedRefs: string[];
};

type JobRow = {
  id: string;
  user_id: string;
  cv_import_id: string;
  status: string;
  phase: string;
  input_signature: string;
  correlation_id: string;
  model_run_id: string | null;
};

export async function stepAtomizationJob(args: StepJobInput): Promise<JobRunnerResult> {
  const { adminClient, userId, jobId } = args;

  const { data: jobData, error: jobError } = await adminClient
    .from("cv_atomization_jobs")
    .select("id, user_id, cv_import_id, status, phase, input_signature, correlation_id, model_run_id")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (jobError) return fail(500, "database_error", "Kunne ikke lese analysejobben.");
  if (!jobData) return fail(404, "not_found", "Fant ikke analysejobben.");
  const job = jobData as JobRow;
  // «Avbrutt» er terminalt for arbeideren: ingen nye modellkall etter dette.
  if (
    job.status === "complete" ||
    job.status === "partial" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return { status: 200, body: { ok: true, done: true, job_status: job.status } };
  }


  const { data: blockData, error: blocksError } = await adminClient
    .from("cv_atomization_job_blocks")
    .select("id, phase, block_key, label, sort_order, status, span_ids, result, metrics, error_code")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });
  if (blocksError) return fail(500, "database_error", "Kunne ikke lese fremdriften.");
  const blocks = (blockData ?? []) as JobBlockRow[];

  const { modelInput } = buildInput(args.allCandidates, args.selectedRefs);
  const plan = planHierarchicalRun(modelInput);

  const profile = await loadProfile(adminClient);
  if (!profile) return fail(500, "server_misconfigured", "Modellprofilen mangler.");

  // Modellkjøringen registreres én gang per jobb.
  let modelRunId = job.model_run_id;
  if (!modelRunId) {
    const { data: runId } = await adminClient.rpc("internal_ai_start_model_run", {
      p_correlation_id: job.correlation_id,
      p_user_id: userId,
      p_task_key: TASK_KEY_V2,
      p_model_id: profile.modelId,
      p_profile_id: profile.profileId,
      p_profile_snapshot: {
        prompt_version: profile.promptVersion,
        pipeline: "hierarchical_async",
        pipeline_version: HIERARCHICAL_PIPELINE_VERSION,
        input_signature: job.input_signature,
        cv_import_id: job.cv_import_id,
        spans: modelInput.sourceSpans.length,
        role_blocks: modelInput.roleBlocks.length,
      },
      p_api_version: "2023-06-01",
    });
    if (typeof runId !== "string") return fail(500, "database_error", "Kunne ikke starte kjøringen.");
    modelRunId = runId;
    await adminClient
      .from("cv_atomization_jobs")
      .update({ model_run_id: modelRunId, status: "running" })
      .eq("id", jobId);
  } else if (job.status === "queued") {
    await adminClient.from("cv_atomization_jobs").update({ status: "running" }).eq("id", jobId);
  }

  const ctx: StepContext = {
    input: modelInput,
    profile,
    anthropicApiKey: args.anthropicApiKey,
    correlationId: job.correlation_id,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  };

  const terminal = (b: JobBlockRow) => b.status !== "queued" && b.status !== "running";
  const appointmentBlocks = blocks.filter((b) => b.phase === "appointments");
  const contentBlocks = blocks.filter((b) => b.phase === "block_content");

  const markRunning = async (ids: string[]) => {
    await adminClient
      .from("cv_atomization_job_blocks")
      .update({ status: "running", started_at: new Date().toISOString() })
      .in("id", ids);
  };

  // ---------------------------------------------------------- fase 1
  const pendingGroups = appointmentBlocks.filter((b) => !terminal(b));
  if (pendingGroups.length > 0) {
    const batch = pendingGroups.slice(0, DEFAULT_MAX_CONCURRENCY);
    await markRunning(batch.map((b) => b.id));
    await adminClient
      .from("cv_atomization_jobs")
      .update({ phase: "appointments" })
      .eq("id", jobId);

    await mapLimit(batch, DEFAULT_MAX_CONCURRENCY, async (block) => {
      const index = plan.appointments.findIndex((g) => g.key === block.block_key);
      const group = plan.appointments[index];
      if (!group) {
        await adminClient
          .from("cv_atomization_job_blocks")
          .update({ status: "complete", result: { roles: [], issues: [] }, finished_at: new Date().toISOString() })
          .eq("id", block.id);
        return;
      }
      const step = await runAppointmentGroupStep(ctx, group, index);
      await adminClient
        .from("cv_atomization_job_blocks")
        .update({
          status: step.metric.ok ? "complete" : "failed",
          sub_batch_signature: step.metric.subBatchSignature,
          error_code: step.metric.errorCode,
          result: { roles: step.roles, issues: step.issues },
          metrics: step.metric as unknown as Record<string, unknown>,
          finished_at: new Date().toISOString(),
        })
        .eq("id", block.id);
    });

    return await progressResponse(adminClient, jobId, "appointments");
  }

  const roles: RoleAtomProposal[] = [];
  const issues: AtomizationIssue[] = [];
  for (const block of appointmentBlocks) {
    const result = (block.result ?? {}) as { roles?: RoleAtomProposal[]; issues?: AtomizationIssue[] };
    if (block.status === "failed") {
      issues.push({
        code: "missing_role_structure",
        sourceSpanIds: block.span_ids,
        message: `Rolleforløpet i «${block.label}» kunne ikke fastsettes. Ansettelsen må gjennomgås manuelt.`,
      });
      continue;
    }
    roles.push(...(result.roles ?? []));
    issues.push(...(result.issues ?? []));
  }

  // ---------------------------------------------------------- fase 2
  const pendingContent = contentBlocks.filter((b) => !terminal(b));
  if (pendingContent.length > 0) {
    const batch = pendingContent.slice(0, DEFAULT_MAX_CONCURRENCY);
    await markRunning(batch.map((b) => b.id));
    await adminClient
      .from("cv_atomization_jobs")
      .update({ phase: "block_content" })
      .eq("id", jobId);

    await mapLimit(batch, DEFAULT_MAX_CONCURRENCY, async (block) => {
      const index = plan.content.findIndex((c) => c.key === block.block_key);
      const planned = plan.content[index];
      if (!planned) {
        await adminClient
          .from("cv_atomization_job_blocks")
          .update({ status: "complete", result: {}, finished_at: new Date().toISOString() })
          .eq("id", block.id);
        return;
      }
      const step = await runBlockContentStep(
        ctx,
        planned,
        roles.filter((r) => r.roleBlockId === planned.key),
        index,
      );
      await adminClient
        .from("cv_atomization_job_blocks")
        .update({
          status: step.metric.ok ? "complete" : "failed",
          sub_batch_signature: step.metric.subBatchSignature,
          error_code: step.metric.errorCode,
          result: {
            achievements: step.achievements,
            skills: step.skills,
            qualifications: step.qualifications,
            issues: step.issues,
          },
          metrics: step.metric as unknown as Record<string, unknown>,
          finished_at: new Date().toISOString(),
        })
        .eq("id", block.id);
    });

    return await progressResponse(adminClient, jobId, "block_content");
  }

  // -------------------------------------- innsamling av fase 1- og 2-utdata
  const achievements: AchievementProposal[] = [];
  const rawSkills: SkillProposal[] = [];
  const qualifications: QualificationProposal[] = [];
  const failedBlocks: { phase: string; key: string; label: string; errorCode: string }[] = [];

  for (const block of appointmentBlocks) {
    if (block.status === "failed") {
      failedBlocks.push({
        phase: "appointments",
        key: block.block_key,
        label: block.label,
        errorCode: block.error_code ?? "error",
      });
    }
  }
  for (const block of contentBlocks) {
    if (block.status === "failed") {
      failedBlocks.push({
        phase: "block_content",
        key: block.block_key,
        label: block.label,
        errorCode: block.error_code ?? "error",
      });
      issues.push({
        code: "insufficient_source_evidence",
        sourceSpanIds: block.span_ids,
        message: `Innholdet i «${block.label}» ble ikke behandlet. Blokken må gjennomgås manuelt.`,
      });
      continue;
    }
    const result = (block.result ?? {}) as {
      achievements?: AchievementProposal[];
      skills?: SkillProposal[];
      qualifications?: QualificationProposal[];
      issues?: AtomizationIssue[];
    };
    achievements.push(...(result.achievements ?? []));
    rawSkills.push(...(result.skills ?? []));
    qualifications.push(...(result.qualifications ?? []));
    issues.push(...(result.issues ?? []));
  }

  // Deterministisk fletting og kalibrering før beleggfasen.
  const merged = finalizeSkills(rawSkills, modelInput);

  // ------------------------------------------- fase 4: kompetansebelegg
  const evidenceBlock = blocks.find((b) => b.phase === "skill_evidence");
  if (evidenceBlock && !terminal(evidenceBlock)) {
    await markRunning([evidenceBlock.id]);
    await adminClient
      .from("cv_atomization_jobs")
      .update({ phase: "skill_evidence" })
      .eq("id", jobId);

    const request = buildSkillEvidenceRequest({
      skills: merged.skills.filter((s) => s.tier === "reviewable"),
      roles,
      achievements,
      input: modelInput,
    });
    const step = await runSkillEvidenceStep({
      profile,
      anthropicApiKey: args.anthropicApiKey,
      correlationId: job.correlation_id,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      request,
    });
    await adminClient
      .from("cv_atomization_job_blocks")
      .update({
        // Feiler beleggfasen, blir kompetansene stående uten kobling — det er
        // en gjennomgangsoppgave, ikke en tapt analyse.
        status: step.ok ? "complete" : "needs_review",
        error_code: step.errorCode,
        result: { assignments: step.assignments },
        metrics: {
          phase: "skill_evidence",
          key: "__skill_evidence__",
          spans: request.skills.length,
          ok: step.ok,
          errorCode: step.errorCode,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", evidenceBlock.id);

    return await progressResponse(adminClient, jobId, "skill_evidence");
  }

  const storedAssignments =
    ((evidenceBlock?.result ?? {}) as { assignments?: SkillEvidenceAssignment[] }).assignments ?? [];
  const linked = applySkillEvidence({
    skills: merged.skills,
    assignments: storedAssignments,
    roles,
    achievements,
  });

  // ---------------------------------------------------------- fase 3: skriving
  const consolidateBlock = blocks.find((b) => b.phase === "consolidate");
  if (consolidateBlock && terminal(consolidateBlock)) {
    return { status: 200, body: { ok: true, done: true, job_status: job.status } };
  }
  if (consolidateBlock) await markRunning([consolidateBlock.id]);
  await adminClient.from("cv_atomization_jobs").update({ phase: "consolidate" }).eq("id", jobId);

  const gated = applyQualityGates(
    hydrateEvidence(
      { roles, achievements, skills: linked.skills, qualifications, issues },
      modelInput,
    ),
    modelInput,
  );


  const { sorted } = buildInput(args.allCandidates, args.selectedRefs);
  const candidatesByRef = new Map(sorted.map((c) => [c.local_ref, c]));
  const spanHashes = new Map<string, string>();
  const spanTexts = new Map<string, string>();
  for (const span of modelInput.sourceSpans) {
    spanTexts.set(span.id, span.text);
    spanHashes.set(span.id, await computeSourceHash(span.text));
  }

  const built = buildProposalRows(gated.output, {
    cvImportId: job.cv_import_id,
    inputSignature: job.input_signature,
    modelRunId: modelRunId!,
    promptVersion: `${profile.promptVersion}+hier${HIERARCHICAL_PIPELINE_VERSION}`,
    normalizerVersion: PREPARSER_VERSION,
    candidatesByRef,
    spanHashes,
    spanTexts,
  });

  // Regnskap: hvert kildespenn som kunne vært et resultat får en eksplisitt
  // klassifisering, begrunnelse og et sted brukeren finner det igjen.
  const resultLedger = buildResultLedger({
    input: modelInput,
    output: gated.output,
    candidates: sorted,
    droppedLocalIds: built.dropped.map((d) => d.local_id),
  });

  const allMetrics = blocks
    .filter((b) => b.phase !== "consolidate")
    .map((b) => b.metrics as unknown as PhaseMetric)
    .filter((m) => m && typeof m === "object");
  const totalInputTokens = allMetrics.reduce((n, m) => n + (m.inputTokens ?? 0), 0);
  const totalOutputTokens = allMetrics.reduce((n, m) => n + (m.outputTokens ?? 0), 0);
  const complete = failedBlocks.length === 0;

  await adminClient.rpc("internal_ai_finish_model_run", {
    p_model_run_id: modelRunId,
    p_status: complete ? "succeeded" : "failed",
    p_outcome: complete ? "ok" : "partial",
    p_error_code: failedBlocks[0]?.errorCode ?? null,
    p_http_status: 200,
    p_request_id: null,
    p_duration_ms: allMetrics.reduce((n, m) => n + (m.durationMs ?? 0), 0),
    p_retry_count: 0,
    p_input_tokens: totalInputTokens,
    p_output_tokens: totalOutputTokens,
  });

  let batchId: string | null = null;
  if (built.kept.length > 0) {
    const { data: writeJson, error: writeError } = await adminClient.rpc(
      "internal_ai_create_enrichment_batch",
      {
        p_user_id: userId,
        p_batch: {
          source_type: "cv_import",
          source_table: "cv_parse_candidates",
          source_id: job.cv_import_id,
          source_record_id: job.cv_import_id,
          source_hash: job.input_signature,
          input_signature: job.input_signature,
          normalizer_version: PREPARSER_VERSION,
          model_run_id: modelRunId,
          title: "Rollebevisst analyse av CV-import",
          status: "open",
          context: {
            task_key: TASK_KEY_V2,
            skill_version: "2.1.0",
            pipeline: "hierarchical_async",
            pipeline_version: HIERARCHICAL_PIPELINE_VERSION,
            model_run_id: modelRunId,
            model_id: profile.modelId,
            prompt_version: profile.promptVersion,
            preparser_version: PREPARSER_VERSION,
            correlation_id: job.correlation_id,
            quality_gates: gated.report,
            phase_metrics: allMetrics,
            skill_merge: merged.report,
            failed_blocks: failedBlocks,
            complete,
            issues: gated.output.issues.slice(0, 20),
            dropped: built.dropped,
            result_ledger: resultLedger,
          },
        },
        p_proposals: built.kept,
      },
    );
    if (writeError || !writeJson) return fail(500, "database_error", "Kunne ikke lagre forslagene.");
    batchId = (writeJson as { batch_id: string }).batch_id;
  }

  // Gjennomgangsgrunnlaget må speile v2.1: rolleutnevnelser er roller (trinn 1),
  // og resultater henger under den rollen v2.1 knyttet dem til (trinn 2).
  let reconcile: ReconcilePlan | null = null;
  if (built.kept.length > 0) {
    try {
      reconcile = await reconcileReviewBasisFromV2(adminClient, {
        userId,
        cvImportId: job.cv_import_id,
        proposals: built.kept as unknown as ReconcileProposal[],
      });
    } catch {
      reconcile = null;
    }
  }


  if (consolidateBlock) {
    await adminClient
      .from("cv_atomization_job_blocks")
      .update({
        status: complete ? "complete" : "needs_review",
        result: { skill_merge: merged.report, proposals: built.kept.length },
        finished_at: new Date().toISOString(),
      })
      .eq("id", consolidateBlock.id);
  }

  const jobStatus = built.kept.length === 0 ? "failed" : complete ? "complete" : "partial";
  await adminClient
    .from("cv_atomization_jobs")
    .update({
      status: jobStatus,
      phase: "done",
      batch_id: batchId,
      error_code: jobStatus === "failed" ? "blocked_validation" : null,
      finished_at: new Date().toISOString(),
      metrics: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        model_calls: allMetrics.length,
        proposals_created: built.kept.length,
        dropped: built.dropped.length,
        quality_gates: gated.report,
        skill_merge: merged.report,
        failed_blocks: failedBlocks,
        roles: gated.output.roles.length,
        achievements: gated.output.achievements.length,
        skills_reviewable: merged.report.consolidation?.reviewable ?? null,
        skills_local_signals: merged.report.consolidation?.localSignals ?? null,
        result_ledger: {
          version: resultLedger.version,
          result_candidate_spans: resultLedger.resultCandidateSpans,
          achievement_proposals: resultLedger.achievementProposals,
          distribution: resultLedger.distribution,
          non_result_entries: resultLedger.nonResultEntries.length,
        },
        review_basis_reconcile: reconcile
          ? {
              updates: reconcile.updates.length,
              unmapped_roles: reconcile.unmappedRoles,
              blocked: reconcile.blocked,
            }
          : null,
      },
    })
    .eq("id", jobId);

  return {
    status: 200,
    body: {
      ok: true,
      done: true,
      job_status: jobStatus,
      batch_id: batchId,
      proposals_created: built.kept.length,
      failed_blocks: failedBlocks,
      result_ledger: resultLedger,
    },
  };
}

async function progressResponse(
  adminClient: any,
  jobId: string,
  phase: string,
): Promise<JobRunnerResult> {
  const { data } = await adminClient
    .from("cv_atomization_job_blocks")
    .select("phase, block_key, label, status, error_code, metrics, sort_order")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });
  return {
    status: 200,
    body: { ok: true, done: false, phase, blocks: data ?? [] },
  };
}
