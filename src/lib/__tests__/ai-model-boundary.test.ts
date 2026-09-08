// Grensetester for det leverandørnøytrale modellgrensesnittet.
//
// Domenekoden skal bare kjenne src/lib/ai-model. Leverandørkoblingen skal
// ligge isolert i adapterområdet utenfor src.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const CLAUDE_CLIENT = "../../../supabase/functions/_shared/claude/client.ts";

const CONSUMERS = [
  "src/lib/occupation-suggest.functions.ts",
  "src/lib/network-suggestions/runner.server.ts",
  "src/routes/api/public/jobs/network-suggestions.ts",
];

vi.mock("../../../supabase/functions/_shared/claude/client.ts", () => ({
  callClaude: vi.fn(async () => ({
    ok: true,
    text: "svar",
    requestId: "req_1",
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null },
    modelId: "modell-1",
    apiVersion: "2023-06-01",
    requestOptionsSnapshot: {},
    durationMs: 12,
    retryCount: 0,
  })),
}));

const PROFILE = {
  profileId: "p1",
  taskKey: "t1",
  modelId: "modell-1",
  promptVersion: "v1",
  maxTokens: 600,
  requestOptions: { top_p: 0.9 },
  capabilities: { supportsTemperature: false, supportsTopP: true },
};

describe("nøytralt AI-modellgrensesnitt", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("domenekonsumentene bruker kun det nøytrale grensesnittet", () => {
    for (const file of CONSUMERS) {
      const src = readFileSync(resolve(ROOT, file), "utf8");
      expect(src).not.toContain("_shared/claude");
      expect(src).not.toContain("callClaude");
      expect(src).not.toContain("ANTHROPIC_API_KEY");
      expect(src).toContain("ai-model/model.server");
    }
  });

  it("adapteren beholder request- og responsekontrakten", async () => {
    const { callClaude } = (await import(CLAUDE_CLIENT)) as unknown as {
      callClaude: ReturnType<typeof vi.fn>;
    };
    callClaude.mockClear();
    const { createClaudeModelClient } =
      await import("../../../supabase/functions/_shared/ai-model/claude-adapter.ts");
    const client = createClaudeModelClient({ apiKey: "hemmelig" });

    const result = await client.call({
      profile: PROFILE,
      system: "system",
      messages: [{ role: "user", content: "hei" }],
      correlationId: "corr-1",
    });

    const sent = callClaude.mock.calls[0]?.[0];
    expect(sent.profile).toEqual(PROFILE);
    expect(sent.system).toBe("system");
    expect(sent.messages).toEqual([{ role: "user", content: "hei" }]);
    expect(sent.correlationId).toBe("corr-1");
    expect(sent.runtime.apiKey).toBe("hemmelig");
    expect("timeoutMs" in sent).toBe(false);
    expect(result).toMatchObject({ ok: true, text: "svar", modelId: "modell-1", retryCount: 0 });
  });

  it("manglende serverkonfigurasjon gir kontrollert feil, ikke unntak", async () => {
    const { createClaudeModelClient } =
      await import("../../../supabase/functions/_shared/ai-model/claude-adapter.ts");
    const previous = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      expect(createClaudeModelClient().isConfigured()).toBe(false);
      const { isModelRuntimeConfigured } = await import("../ai-model/model.server");
      await expect(isModelRuntimeConfigured()).resolves.toBe(false);
    } finally {
      if (previous !== undefined) process.env["ANTHROPIC_API_KEY"] = previous;
    }
  });

  it("fabrikken velger fortsatt dagens motor som standard", async () => {
    process.env["ANTHROPIC_API_KEY"] = "hemmelig";
    const { resolveModelClient } = await import("../ai-model/model.server");
    const client = await resolveModelClient();
    expect(client.isConfigured()).toBe(true);
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("de nøytrale typene lekker verken leverandørnavn eller hemmeligheter", () => {
    const types = readFileSync(resolve(ROOT, "src/lib/ai-model/types.ts"), "utf8");
    for (const word of ["claude", "anthropic", "openai", "gemini", "grok", "apiKey"]) {
      expect(types.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("ruten sender verken hemmelighet eller leverandørnavn til klienten", () => {
    const route = readFileSync(
      resolve(ROOT, "src/routes/api/public/jobs/network-suggestions.ts"),
      "utf8",
    );
    expect(route.toLowerCase()).not.toContain("anthropic");
    expect(route.toLowerCase()).not.toContain("claude");
    expect(route).toContain("server_misconfigured");
  });
});
