import { fetchRegnskap, RateLimiter, shouldRetryImmediately } from "./brreg.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("retry policy does not retry deterministic upstream 500", () => {
  assert(
    !shouldRetryImmediately(500),
    "500 must be handled by DB backoff, not in-run retry",
  );
  assert(
    shouldRetryImmediately(429),
    "429 remains an immediate retry candidate",
  );
  assert(
    shouldRetryImmediately(503),
    "503 remains an immediate retry candidate",
  );
  assert(
    shouldRetryImmediately(504),
    "504 remains an immediate retry candidate",
  );
});

Deno.test("fetchRegnskap fast-fails upstream 500 after one attempt", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(response(500, { error: "Internal Server Error" }));
  }) as typeof fetch;
  try {
    const result = await fetchRegnskap("937903146", new RateLimiter(10_000));
    assert(
      result.kind === "retry_exhausted",
      "500 should become retry_exhausted",
    );
    assert(result.status === 500, "status should be preserved");
    assert(result.attempts === 1, "500 should not be retried in the same run");
    assert(calls === 1, "fetch should be called once");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchRegnskap keeps success and empty-result semantics", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [
    response(200, [{ id: 1 }]),
    response(200, []),
    response(404, { error: "not found" }),
  ];
  globalThis.fetch = (() => Promise.resolve(bodies.shift()!)) as typeof fetch;
  try {
    const ok = await fetchRegnskap("123456789", new RateLimiter(10_000));
    assert(ok.kind === "ok", "non-empty array should be ok");
    const none = await fetchRegnskap("123456780", new RateLimiter(10_000));
    assert(none.kind === "no_regnskap", "empty array should be no_regnskap");
    const missing = await fetchRegnskap("123456781", new RateLimiter(10_000));
    assert(missing.kind === "not_found", "404 should stay not_found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
