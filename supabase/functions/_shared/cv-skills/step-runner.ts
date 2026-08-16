// Kjøring av ett modellsteg med full sporbarhet.
//
// Kontrakt (fase 2, kontraktsrettelse):
//   configuration_error  -> ai.model_runs.status = 'configuration_error'
//                           ai.model_runs.outcome = 'configuration_error'
//                           cv_generation_jobs.status = 'failed'
//                           cv_generation_jobs.error_code = 'configuration_error'
//                           ingen Anthropic-request, ingen retry
//
// Portene injiseres slik at kallene kan verifiseres i test uten database
// og uten nettverk.

import {
  callClaude,
  type ClaudeCallResult,
  type ClaudeRuntimePort,
  type ModelProfile,
} from "../claude/client.ts";
import type { StepOutcome } from "./contract.ts";

export type ModelRunPorts = {
  /** Oppretter ai.model_runs-rad med status 'running'. Returnerer run-id. */
  startModelRun(input: {
    correlationId: string;
    jobId: string;
    profile: ModelProfile;
  }): Promise<string>;
  /** Avslutter ai.model_runs-raden. finished_at settes av porten. */
  finishModelRun(input: {
    modelRunId: string;
    status: "succeeded" | "failed" | "cancelled" | "configuration_error";
    outcome: StepOutcome | "invalid_output" | null;
    errorCode: string | null;
    httpStatus: number | null;
    requestId: string | null;
    durationMs: number;
    retryCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }): Promise<void>;
  /** public.internal_ai_fail_job — terminal, ingen requeue. */
  failJob(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    error: string;
    modelRunId: string | null;
  }): Promise<void>;
};

export type StepResult = {
  outcome: StepOutcome;
  modelRunId: string;
  text: string | null;
  errorCode: string | null;
  /** true bare når steget kan forsøkes på nytt. */
  retryable: boolean;
};

export async function runModelStep(
  input: {
    profile: ModelProfile;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    correlationId: string;
    jobId: string;
    workerId: string;
    /** Injisert runtime med API-nøkkel. Klienten leser aldri env selv. */
    runtime: ClaudeRuntimePort;
    timeoutMs?: number;
    maxRetries?: number;
  },
  ports: ModelRunPorts,
): Promise<StepResult> {
  const modelRunId = await ports.startModelRun({
    correlationId: input.correlationId,
    jobId: input.jobId,
    profile: input.profile,
  });

  const result: ClaudeCallResult = await callClaude({
    profile: input.profile,
    system: input.system,
    messages: input.messages,
    correlationId: input.correlationId,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
  });

  if (result.ok) {
    await ports.finishModelRun({
      modelRunId,
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
    return { outcome: "ok", modelRunId, text: result.text, errorCode: null, retryable: false };
  }

  const isConfig = result.outcome === "configuration_error";

  await ports.finishModelRun({
    modelRunId,
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
    // Feilkonfigurasjon retter seg ikke av seg selv. Jobben avsluttes terminalt.
    console.error(
      "[step-runner] configuration_error",
      JSON.stringify({
        correlationId: input.correlationId,
        jobId: input.jobId,
        taskKey: input.profile.taskKey,
        profileId: input.profile.profileId,
        errorCode: result.errorCode,
      }),
    );
    await ports.failJob({
      jobId: input.jobId,
      workerId: input.workerId,
      errorCode: "configuration_error",
      error: result.errorCode,
      modelRunId,
    });
    return {
      outcome: "configuration_error",
      modelRunId,
      text: null,
      errorCode: result.errorCode,
      retryable: false,
    };
  }

  return {
    outcome: result.outcome === "timeout" ? "timeout" : "provider_error",
    modelRunId,
    text: null,
    errorCode: result.errorCode,
    retryable: true,
  };
}
