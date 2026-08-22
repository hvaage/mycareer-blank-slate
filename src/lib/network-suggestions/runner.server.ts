// Fase 5D — kjøring av én forslagsjobb. Server-only.
//
//   - modell: eksisterende Claude-klient med navngitt profil
//     (task_key = network_activity_suggestions)
//   - ai.model_runs får profil, versjon, tokens, status og korrelasjons-ID.
//     Aldri rå prompt, respons, kontaktdata eller annonsetekst.
//   - evidens valideres mot en lukket liste; ukjente referanser forkastes
//   - forslag oppretter aldri aktiviteter, sender aldri meldinger

import type { ModelProfile } from "../../../supabase/functions/_shared/claude/client.ts";
import { buildSuggestionContext, type EvidenceRef, type SuggestionScope } from "./context.server";

const TASK_KEY = "network_activity_suggestions";
const OUTPUT_CONTRACT_VERSION = "1";

const ACTIVITY_TYPES = [
  "oppfolging",
  "moete",
  "samtale",
  "e_post",
  "soknad",
  "intervju",
  "annet",
] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

export type ValidatedSuggestion = {
  activityType: string;
  title: string;
  rationale: string;
  priority: string;
  suggestedTiming: { horizonDays: number | null; note: string | null };
  context: { scope: SuggestionScope; scopeObjectId: string | null };
  evidence: EvidenceRef[];
};

type Admin = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>; from: (t: string) => any };

export type RunOutcome =
  | { status: "succeeded"; items: ValidatedSuggestion[]; modelRunId: string | null; modelName: string | null }
  | { status: "failed" | "retry"; errorCode: string; modelRunId: string | null; modelName: string | null };

async function loadProfile(adminClient: Admin): Promise<ModelProfile | null> {
  const { data, error } = await adminClient.rpc("internal_ai_get_active_profile", {
    p_task_key: TASK_KEY,
  });
  if (error || !data) return null;
  const p = data as any;
  return {
    profileId: p.profile_id,
    taskKey: TASK_KEY,
    modelId: p.model_id,
    promptVersion: `${p.prompt_version}+out${OUTPUT_CONTRACT_VERSION}`,
    maxTokens: p.max_tokens,
    requestOptions: p.request_options ?? {},
    capabilities: {
      supportsTemperature: p.capabilities?.supportsTemperature === true,
      supportsTopP: p.capabilities?.supportsTopP === true,
      supportsTopK: p.capabilities?.supportsTopK === true,
      supportsThinking: p.capabilities?.supportsThinking === true,
      supportsPrefill: p.capabilities?.supportsPrefill === true,
    },
  };
}

const SYSTEM_PROMPT = `Du er en norsk karriererådgiver som hjelper en jobbsøker å prioritere konkret nettverksarbeid og søknadsoppfølging.

Regler:
- Du foreslår kun. Du oppretter ingenting, sender ingen meldinger og endrer ingen status.
- Du skal kun vise til kildeobjekter fra listen «Tillatte kilder», med nøyaktig samme ref-streng.
- Ikke finn på selskaper, personer, stillinger eller fakta som ikke står i konteksten.
- Ikke foreslå noe som allerede finnes som åpen aktivitet.
- Skriv all tekst på norsk (bokmål), kort og handlingsrettet.

Svar KUN med gyldig JSON på formen:
{"suggestions":[{"activityType":"oppfolging|moete|samtale|e_post|soknad|intervju|annet","title":"...","rationale":"...","priority":"low|medium|high","suggestedTiming":{"horizonDays":7,"note":"..."},"evidence":["company:<uuid>"]}]}

Maks 5 forslag. Hvert forslag må ha minst én gyldig ref i evidence.`;

function buildUserMessage(scope: SuggestionScope, evidence: EvidenceRef[]): string {
  const lines = evidence.map(
    (e) => `- ${e.ref} | ${e.kind} | ${e.label}${e.detail ? ` | ${e.detail}` : ""}`,
  );
  return [
    `Arbeidsflate: ${scope}`,
    "",
    "Tillatte kilder:",
    ...(lines.length ? lines : ["(ingen)"]),
    "",
    "Foreslå de viktigste neste stegene basert kun på kildene over.",
  ].join("\n");
}

function parseSuggestions(raw: string, allowed: Map<string, EvidenceRef>, scope: SuggestionScope, scopeObjectId: string | null): ValidatedSuggestion[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const out: ValidatedSuggestion[] = [];

  for (const item of items.slice(0, 5)) {
    const activityType = (ACTIVITY_TYPES as readonly string[]).includes(item?.activityType)
      ? item.activityType
      : "annet";
    const priority = (PRIORITIES as readonly string[]).includes(item?.priority) ? item.priority : "medium";
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 200) : "";
    const rationale = typeof item?.rationale === "string" ? item.rationale.trim().slice(0, 1200) : "";
    if (!title || !rationale) continue;

    const refs: EvidenceRef[] = [];
    for (const ref of Array.isArray(item?.evidence) ? item.evidence : []) {
      const hit = typeof ref === "string" ? allowed.get(ref) : undefined;
      if (hit && !refs.some((r) => r.ref === hit.ref)) refs.push(hit);
    }
    if (refs.length === 0) continue;

    const horizon = Number(item?.suggestedTiming?.horizonDays);
    out.push({
      activityType,
      title,
      rationale,
      priority,
      suggestedTiming: {
        horizonDays: Number.isFinite(horizon) && horizon >= 0 && horizon <= 180 ? Math.round(horizon) : null,
        note:
          typeof item?.suggestedTiming?.note === "string"
            ? item.suggestedTiming.note.trim().slice(0, 200)
            : null,
      },
      context: { scope, scopeObjectId },
      evidence: refs,
    });
  }
  return out;
}

export async function runSuggestionJob(input: {
  adminClient: Admin;
  apiKey: string;
  userId: string;
  scope: SuggestionScope;
  scopeObjectId: string | null;
  correlationId: string;
}): Promise<RunOutcome> {
  const { adminClient, apiKey, userId, scope, scopeObjectId, correlationId } = input;

  const profile = await loadProfile(adminClient);
  if (!profile) {
    return { status: "failed", errorCode: "missing_model_profile", modelRunId: null, modelName: null };
  }

  const context = await buildSuggestionContext({ adminClient, userId, scope, scopeObjectId });
  if (context.evidence.length === 0) {
    return { status: "succeeded", items: [], modelRunId: null, modelName: profile.modelId };
  }

  const { data: modelRunId } = await adminClient.rpc("internal_ai_start_model_run", {
    p_correlation_id: correlationId,
    p_user_id: userId,
    p_task_key: TASK_KEY,
    p_model_id: profile.modelId,
    p_profile_id: profile.profileId,
    p_profile_snapshot: {
      prompt_version: profile.promptVersion,
      max_tokens: profile.maxTokens,
      request_options: profile.requestOptions,
      scope,
      evidence_count: context.evidence.length,
    },
    p_api_version: "2023-06-01",
  });
  const runId = typeof modelRunId === "string" ? modelRunId : null;

  const { callClaude } = await import("../../../supabase/functions/_shared/claude/client.ts");
  const result = await callClaude({
    profile,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(scope, context.evidence) }],
    correlationId,
    runtime: { apiKey },
  });

  const finish = async (
    status: "succeeded" | "failed" | "configuration_error",
    errorCode: string | null,
    outcome: string | null,
  ) => {
    if (!runId) return;
    await adminClient.rpc("internal_ai_finish_model_run", {
      p_model_run_id: runId,
      p_status: status,
      p_outcome: outcome,
      p_error_code: errorCode,
      p_http_status: result.ok ? 200 : result.status,
      p_request_id: result.requestId ?? null,
      p_duration_ms: result.durationMs,
      p_retry_count: result.retryCount,
      p_input_tokens: result.ok ? result.usage.inputTokens : null,
      p_output_tokens: result.ok ? result.usage.outputTokens : null,
    });
  };

  if (!result.ok) {
    await finish(result.outcome === "configuration_error" ? "configuration_error" : "failed", result.errorCode, result.outcome);
    const retryable = result.outcome === "timeout" || (result.status !== null && result.status >= 500) || result.status === 429;
    return {
      status: retryable ? "retry" : "failed",
      errorCode: result.errorCode,
      modelRunId: runId,
      modelName: profile.modelId,
    };
  }

  const allowed = new Map(context.evidence.map((e) => [e.ref, e]));
  const items = parseSuggestions(result.text, allowed, scope, scopeObjectId);
  if (items.length === 0) {
    await finish("failed", "invalid_model_output", "invalid_output");
    return { status: "failed", errorCode: "invalid_model_output", modelRunId: runId, modelName: profile.modelId };
  }

  await finish("succeeded", null, "ok");
  return { status: "succeeded", items, modelRunId: runId, modelName: profile.modelId };
}
