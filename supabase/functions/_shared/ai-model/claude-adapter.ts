// Server-only adapter: nøytralt modellgrensesnitt -> eksisterende Claude-klient.
//
// Dette er det ENESTE stedet i kjeden som kjenner leverandøren. Adapteren
// endrer ikke prompts, profilverdier, timeout, retry eller resultatsemantikk —
// den oversetter bare typer og injiserer runtime-nøkkelen fra servermiljøet.

import { callClaude } from "../claude/client.ts";

export type AdapterCallInput = {
  profile: {
    profileId: string;
    taskKey: string;
    modelId: string;
    promptVersion: string;
    maxTokens: number;
    requestOptions: Record<string, unknown>;
    capabilities: {
      supportsTemperature: boolean;
      supportsTopP: boolean;
      supportsTopK?: boolean;
      supportsThinking?: boolean;
      supportsPrefill?: boolean;
    };
  };
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  correlationId: string;
  timeoutMs?: number;
  maxRetries?: number;
};

function readApiKey(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.["ANTHROPIC_API_KEY"] ?? "";
}

export function createClaudeModelClient(options?: { apiKey?: string }) {
  const apiKeyOf = () => options?.apiKey ?? readApiKey();
  return {
    engineId: "claude",
    isConfigured(): boolean {
      return apiKeyOf().length > 0;
    },
    async call(input: AdapterCallInput) {
      return await callClaude({
        profile: input.profile,
        system: input.system,
        messages: input.messages,
        correlationId: input.correlationId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
        runtime: { apiKey: apiKeyOf() },
      });
    },
  };
}
