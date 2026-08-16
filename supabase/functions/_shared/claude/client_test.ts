// Deno-tester for capability-filtrering i Claude-klienten.
// Kjør: deno test supabase/functions/_shared/claude/client_test.ts

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClaudeConfigurationError,
  type ModelCapabilities,
  sanitizeMessages,
  sanitizeRequestOptions,
} from "./client.ts";


const base: ModelCapabilities = {
  supportsTemperature: false,
  supportsTopP: false,
  supportsTopK: false,
  supportsThinking: false,
  supportsPrefill: false,
};

Deno.test("temperature og top_p fjernes når modellen ikke støtter dem", () => {
  const out = sanitizeRequestOptions({ temperature: 0.4, top_p: 0.9, stop_sequences: ["</x>"] }, base);
  assertEquals(out, { stop_sequences: ["</x>"] });
});

Deno.test("top_k fjernes uten støtte, beholdes med støtte", () => {
  assertEquals(sanitizeRequestOptions({ top_k: 40 }, base), {});
  assertEquals(sanitizeRequestOptions({ top_k: 40 }, { ...base, supportsTopK: true }), { top_k: 40 });
});

Deno.test("thinking fjernes uten støtte, beholdes med støtte", () => {
  const thinking = { type: "enabled", budget_tokens: 2000 };
  assertEquals(sanitizeRequestOptions({ thinking }, base), {});
  assertEquals(sanitizeRequestOptions({ thinking }, { ...base, supportsThinking: true }), { thinking });
});

Deno.test("top_k kombineres aldri med aktiv extended thinking", () => {
  const out = sanitizeRequestOptions(
    { top_k: 40, thinking: { type: "enabled", budget_tokens: 2000 } },
    { ...base, supportsTopK: true, supportsThinking: true },
  );
  assertEquals(out, { thinking: { type: "enabled", budget_tokens: 2000 } });
});

Deno.test("prefill uten modellstøtte gir eksplisitt konfigurasjonsfeil", () => {
  const messages = [
    { role: "user" as const, content: "Skriv JSON" },
    { role: "assistant" as const, content: "{" },
  ];
  const err = assertThrows(
    () => sanitizeMessages(messages, base),
    ClaudeConfigurationError,
  ) as ClaudeConfigurationError;
  assertEquals(err.errorCode, "unsupported_prefill");
  assertEquals(sanitizeMessages(messages, { ...base, supportsPrefill: true }).length, 2);
});

Deno.test("prefill kombinert med extended thinking gir konfigurasjonsfeil", () => {
  const messages = [
    { role: "user" as const, content: "Skriv JSON" },
    { role: "assistant" as const, content: "{" },
  ];
  const err = assertThrows(
    () =>
      sanitizeMessages(messages, { ...base, supportsPrefill: true, supportsThinking: true }, {
        thinking: { type: "enabled", budget_tokens: 1024 },
      }),
    ClaudeConfigurationError,
  ) as ClaudeConfigurationError;
  assertEquals(err.errorCode, "prefill_with_thinking");
});


Deno.test("meldinger uten prefill er uendret", () => {
  const messages = [{ role: "user" as const, content: "Hei" }];
  assertEquals(sanitizeMessages(messages, base), messages);
});
