// Felles Claude-klient. Server-only (filnavnet blokkerer klientbundling).
//
// Prinsipper:
//   - Base-URL er låst. Ingen konfigurerbar endepunkt-URL.
//   - Modell-id og request-options kommer alltid fra en godkjent serverprofil.
//   - Parametere modellen ikke støtter (bl.a. temperature på Sonnet 5) utelates
//     i stedet for å sendes og feile.
//   - Retry kun ved transient 429/5xx/nettverk, med eksponentiell backoff.
//     Ingen modellfallback.
//   - Rå CV-tekst logges aldri. Bare metadata.

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

export type ModelCapabilities = {
  supportsTemperature: boolean;
  supportsTopP: boolean;
  /** Sampling med top_k. Ikke støttet sammen med extended thinking. */
  supportsTopK?: boolean;
  /** Extended thinking (thinking-blokk i request). */
  supportsThinking?: boolean;
  /** Prefill: siste melding kan være en assistant-melding modellen fortsetter på. */
  supportsPrefill?: boolean;
};


export type ModelProfile = {
  profileId: string;
  taskKey: string;
  modelId: string;
  promptVersion: string;
  maxTokens: number;
  /** Rå ønskede parametere. Filtreres mot capabilities før kall. */
  requestOptions: Record<string, unknown>;
  capabilities: ModelCapabilities;
};

export type ClaudeCallInput = {
  profile: ModelProfile;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Korrelasjons-id for logg og ai.model_runs. */
  correlationId: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ClaudeUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export type ClaudeCallResult =
  | {
      ok: true;
      text: string;
      requestId: string | null;
      usage: ClaudeUsage;
      modelId: string;
      apiVersion: string;
      requestOptionsSnapshot: Record<string, unknown>;
      durationMs: number;
      retryCount: number;
    }
  | {
      ok: false;
      outcome: "provider_error" | "timeout" | "configuration_error";
      errorCode: string;
      status: number | null;
      requestId: string | null;
      durationMs: number;
      retryCount: number;
    };

/** Fjerner parametere modellen ikke støtter. Sendes de likevel, feiler kallet. */
export function sanitizeRequestOptions(
  options: Record<string, unknown>,
  capabilities: ModelCapabilities,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const thinkingEnabled =
    capabilities.supportsThinking === true &&
    typeof options["thinking"] === "object" &&
    options["thinking"] !== null &&
    (options["thinking"] as { type?: string }).type === "enabled";

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (key === "temperature" && !capabilities.supportsTemperature) continue;
    if (key === "top_p" && !capabilities.supportsTopP) continue;
    if (key === "top_k" && capabilities.supportsTopK !== true) continue;
    // top_k kan ikke kombineres med extended thinking.
    if (key === "top_k" && thinkingEnabled) continue;
    if (key === "thinking" && capabilities.supportsThinking !== true) continue;
    if (key === "model" || key === "messages" || key === "system" || key === "max_tokens") continue;
    out[key] = value;
  }
  return out;
}

/** Konfigurasjonsfeil: kallet er ugyldig for valgt modellprofil. Ingen lydløs degradering. */
export class ClaudeConfigurationError extends Error {
  constructor(readonly errorCode: string, message: string) {
    super(message);
    this.name = "ClaudeConfigurationError";
  }
}

/**
 * Prefill = siste melding er en assistant-melding modellen skal fortsette på.
 * Støtter ikke modellen prefill (eller er extended thinking aktiv), er kallet
 * feilkonfigurert. Meldingen fjernes IKKE lydløst — det gir en eksplisitt feil.
 */
export function sanitizeMessages(
  messages: { role: "user" | "assistant"; content: string }[],
  capabilities: ModelCapabilities,
  sanitizedOptions: Record<string, unknown> = {},
): { role: "user" | "assistant"; content: string }[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;
  const thinkingEnabled =
    (sanitizedOptions["thinking"] as { type?: string } | undefined)?.type === "enabled";
  if (capabilities.supportsPrefill !== true) {
    throw new ClaudeConfigurationError(
      "unsupported_prefill",
      "Modellprofilen støtter ikke assistant-prefill, men siste melding er en prefill.",
    );
  }
  if (thinkingEnabled) {
    throw new ClaudeConfigurationError(
      "prefill_with_thinking",
      "Assistant-prefill kan ikke kombineres med extended thinking.",
    );
  }
  return messages;
}



function isTransient(status: number | null): boolean {
  if (status === null) return true; // nettverksfeil
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readUsage(payload: any): ClaudeUsage {
  const u = payload?.usage ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  };
}

function readText(payload: any): string {
  const parts = Array.isArray(payload?.content) ? payload.content : [];
  return parts
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("");
}

export async function callClaude(input: ClaudeCallInput): Promise<ClaudeCallResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const started = Date.now();
  if (!apiKey) {
    console.error("[claude] missing_configuration", JSON.stringify({ correlationId: input.correlationId }));
    return {
      ok: false,
      outcome: "provider_error",
      errorCode: "missing_api_key",
      status: null,
      requestId: null,
      durationMs: 0,
      retryCount: 0,
    };
  }

  const { profile } = input;
  const options = sanitizeRequestOptions(profile.requestOptions, profile.capabilities);
  let messages: { role: "user" | "assistant"; content: string }[];
  try {
    messages = sanitizeMessages(input.messages, profile.capabilities, options);
  } catch (err) {
    if (err instanceof ClaudeConfigurationError) {
      console.error(
        "[claude] configuration_error",
        JSON.stringify({
          correlationId: input.correlationId,
          taskKey: profile.taskKey,
          model: profile.modelId,
          errorCode: err.errorCode,
        }),
      );
      return {
        ok: false,
        outcome: "configuration_error",
        errorCode: err.errorCode,
        status: null,
        requestId: null,
        durationMs: Date.now() - started,
        retryCount: 0,
      };
    }
    throw err;
  }

  const body = {
    model: profile.modelId,
    max_tokens: profile.maxTokens,
    system: input.system,
    messages,
    ...options,
  };
  const requestOptionsSnapshot = { max_tokens: profile.maxTokens, ...options };

  const timeoutMs = input.timeoutMs ?? 90_000;
  const maxRetries = input.maxRetries ?? 2;

  let retryCount = 0;
  let lastStatus: number | null = null;
  let lastRequestId: string | null = null;
  let lastErrorCode = "unknown_error";

  while (retryCount <= maxRetries) {
    const attemptStarted = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(ANTHROPIC_BASE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;
      lastRequestId = res.headers.get("request-id");

      if (!res.ok) {
        lastErrorCode = `http_${res.status}`;
        console.error(
          "[claude] call failed",
          JSON.stringify({
            correlationId: input.correlationId,
            taskKey: profile.taskKey,
            model: profile.modelId,
            status: res.status,
            requestId: lastRequestId,
            attempt: retryCount + 1,
          }),
        );
        if (isTransient(res.status) && retryCount < maxRetries) {
          retryCount += 1;
          await sleep(500 * 2 ** retryCount);
          continue;
        }
        return {
          ok: false,
          outcome: "provider_error",
          errorCode: lastErrorCode,
          status: res.status,
          requestId: lastRequestId,
          durationMs: Date.now() - started,
          retryCount,
        };
      }

      const payload = await res.json();
      const usage = readUsage(payload);
      console.info(
        "[claude] ok",
        JSON.stringify({
          correlationId: input.correlationId,
          taskKey: profile.taskKey,
          model: profile.modelId,
          apiVersion: ANTHROPIC_API_VERSION,
          requestId: lastRequestId,
          durationMs: Date.now() - attemptStarted,
          usage,
          retryCount,
        }),
      );
      return {
        ok: true,
        text: readText(payload),
        requestId: lastRequestId,
        usage,
        modelId: profile.modelId,
        apiVersion: ANTHROPIC_API_VERSION,
        requestOptionsSnapshot,
        durationMs: Date.now() - started,
        retryCount,
      };
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      lastErrorCode = aborted ? "timeout" : "network_error";
      console.error(
        "[claude] transport failure",
        JSON.stringify({
          correlationId: input.correlationId,
          taskKey: profile.taskKey,
          model: profile.modelId,
          errorCode: lastErrorCode,
          attempt: retryCount + 1,
        }),
      );
      if (!aborted && retryCount < maxRetries) {
        retryCount += 1;
        await sleep(500 * 2 ** retryCount);
        continue;
      }
      return {
        ok: false,
        outcome: aborted ? "timeout" : "provider_error",
        errorCode: lastErrorCode,
        status: null,
        requestId: null,
        durationMs: Date.now() - started,
        retryCount,
      };
    }
  }

  return {
    ok: false,
    outcome: "provider_error",
    errorCode: lastErrorCode,
    status: lastStatus,
    requestId: lastRequestId,
    durationMs: Date.now() - started,
    retryCount,
  };
}

export const CLAUDE_RUNTIME = {
  baseUrl: ANTHROPIC_BASE_URL,
  apiVersion: ANTHROPIC_API_VERSION,
} as const;
