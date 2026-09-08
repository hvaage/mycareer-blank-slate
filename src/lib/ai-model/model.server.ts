// Server-only fabrikk for den konfigurerte AI-motoren.
//
// Domenekoden kaller `callModel` / `isModelRuntimeConfigured` og vet ikke
// hvilken leverandør som ligger bak. I dag er det én motor. Nye motorer
// (OpenAI, Gemini, Grok) legges til her og i adapterområdet — ikke i
// domenelogikken. Adapterne ligger utenfor src, bak serverboundary.

import type { AiModelClient, ModelCallInput, ModelCallResult } from "./types";

const ADAPTERS = {
  claude: async () => {
    const mod = await import("../../../supabase/functions/_shared/ai-model/claude-adapter.ts");
    return mod.createClaudeModelClient() as unknown as AiModelClient;
  },
} as const;

type EngineId = keyof typeof ADAPTERS;

const DEFAULT_ENGINE: EngineId = "claude";

function configuredEngine(): EngineId {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const raw = env?.["AI_MODEL_ENGINE"];
  return raw && raw in ADAPTERS ? (raw as EngineId) : DEFAULT_ENGINE;
}

/** Løser opp motoren som skal brukes nå. Server-only. */
export async function resolveModelClient(): Promise<AiModelClient> {
  return await ADAPTERS[configuredEngine()]();
}

/**
 * True når servermiljøet er konfigurert for motoren. Brukes der kallende kode
 * må feile kontrollert før den starter arbeid — samme oppførsel som før.
 */
export async function isModelRuntimeConfigured(): Promise<boolean> {
  const client = await resolveModelClient();
  return client.isConfigured();
}

/** Ett modellkall. Resultatkontrakten er uendret fra tidligere. */
export async function callModel(input: ModelCallInput): Promise<ModelCallResult> {
  const client = await resolveModelClient();
  return await client.call(input);
}
