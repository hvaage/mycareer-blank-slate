import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ModelProfile } from "../claude/client.ts";
import { runModelStep } from "./step-runner.ts";

const profileUtenPrefill: ModelProfile = {
  profileId: "11111111-1111-4111-8111-111111111111",
  taskKey: "propose_cv_atoms",
  modelId: "claude-sonnet-5",
  promptVersion: "v1",
  maxTokens: 2048,
  requestOptions: {},
  capabilities: { supportsTemperature: false, supportsTopP: false, supportsPrefill: false },
};

Deno.test("unsupported_prefill: ingen API-kall, configuration_error, jobb failed", async () => {
  process.env["ANTHROPIC_API_KEY"] = "test-key-not-used";

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls += 1;
    return Promise.reject(new Error("fetch skal ikke kalles"));
  }) as typeof fetch;

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };

  const modelRunPatches: Record<string, unknown>[] = [];
  const jobFailures: Record<string, unknown>[] = [];

  try {
    const result = await runModelStep(
      {
        profile: profileUtenPrefill,
        system: "system",
        messages: [
          { role: "user", content: "Foreslå atomer" },
          { role: "assistant", content: "{" },
        ],
        correlationId: "corr-cfg-001",
        jobId: "22222222-2222-4222-8222-222222222222",
        workerId: "worker-test",
        runtime: { apiKey: "test-key" },
      },
      {
        startModelRun: () => Promise.resolve("33333333-3333-4333-8333-333333333333"),
        finishModelRun: (patch) => {
          modelRunPatches.push(patch as unknown as Record<string, unknown>);
          return Promise.resolve();
        },
        failJob: (patch) => {
          jobFailures.push(patch as unknown as Record<string, unknown>);
          return Promise.resolve();
        },
      },
    );

    // Ingen Anthropic-request.
    assertEquals(fetchCalls, 0);

    // Modellkjøringen lagres som configuration_error (gyldig CHECK-verdi).
    assertEquals(modelRunPatches.length, 1);
    assertEquals(modelRunPatches[0]?.["status"], "configuration_error");
    assertEquals(modelRunPatches[0]?.["outcome"], "configuration_error");
    assertEquals(modelRunPatches[0]?.["errorCode"], "unsupported_prefill");
    assertEquals(modelRunPatches[0]?.["retryCount"], 0);

    // Jobben avsluttes terminalt, uten requeue.
    assertEquals(jobFailures.length, 1);
    assertEquals(jobFailures[0]?.["errorCode"], "configuration_error");

    assertEquals(result.outcome, "configuration_error");
    assertEquals(result.retryable, false);

    // Korrelasjons-id finnes i kjøringsloggen.
    assertEquals(logged.some((line) => line.includes("corr-cfg-001")), true);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
