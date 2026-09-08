// Leverandørnøytralt modellgrensesnitt for domenekoden.
//
// Domenekoden skal aldri kjenne hvilken leverandør som faktisk brukes.
// Typene her er bevisst nøytrale: ingen leverandørnavn, ingen nøkler og
// ingen leverandørspesifikke felter. Adapterlaget (utenfor src) oversetter
// til og fra den konkrete leverandørklienten uten å endre semantikken.

export type ModelCapabilities = {
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsTopK?: boolean;
  supportsThinking?: boolean;
  supportsPrefill?: boolean;
};

/** Godkjent serverprofil. Verdiene kommer alltid fra ai.model_profiles. */
export type ModelProfile = {
  profileId: string;
  taskKey: string;
  modelId: string;
  promptVersion: string;
  maxTokens: number;
  requestOptions: Record<string, unknown>;
  capabilities: ModelCapabilities;
};

export type ModelMessage = { role: "user" | "assistant"; content: string };

export type ModelCallInput = {
  profile: ModelProfile;
  system: string;
  messages: ModelMessage[];
  correlationId: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export type ModelCallResult =
  | {
      ok: true;
      text: string;
      requestId: string | null;
      usage: ModelUsage;
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

/** Ett kall til den konfigurerte motoren. Implementeres av adapterlaget. */
export type AiModelClient = {
  /** Stabil, ikke-hemmelig id for motoren. Sendes aldri til nettleseren. */
  readonly engineId: string;
  /** True når servermiljøet har det som trengs for å kalle motoren. */
  isConfigured(): boolean;
  call(input: ModelCallInput): Promise<ModelCallResult>;
};
