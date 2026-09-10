// ============================================================
// Invarianter i `authenticateOauthRequest`.
//
// 1) Et access token gir adgang KUN når integrasjonen er `active`.
//    Første vellykkede tokenutstedelse aktiverer integrasjonen atomisk,
//    så `connecting` trenger ingen dataadgang. `degraded` og
//    `disconnected` gir aldri adgang.
// 2) Tokenets scopes kryssjekkes mot grantets nåværende scopes ved hvert
//    kall. Trekkes et scope tilbake, avvises tokenet (fail closed).
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://karrierenmin.no";

let payload = {
  sub: "user-1",
  iid: "int-1",
  grant_id: "grant-1",
  client_id: "client-1",
  provider: "claude",
  scopes: ["karriere.status.read", "karriere.workflow.run"],
  jti: "jti-1",
};

vi.mock("@/lib/ai-integrations/oauth-config.server", () => ({
  publicAppOrigin: () => ({ ok: true, origin: ORIGIN }),
  oauthUrls: (origin: string) => ({
    resource: `${origin}/api/public/mcp`,
    resourcePath: "/api/public/mcp",
    issuer: origin,
  }),
  mcpResourceIdentifiers: (origin: string) => [`${origin}/api/public/mcp`, `${origin}/mcp`],
}));

vi.mock("@/lib/ai-integrations/oauth-access-token.server", () => ({
  verifyOauthAccessToken: () => Promise.resolve({ ok: true, payload }),
}));

let grantRow: Record<string, unknown> | null;
let integrationRow: Record<string, unknown> | null;
let clientRow: Record<string, unknown> | null;

vi.mock("@/lib/ai-integrations/oauth-store.server", () => ({
  isRevoked: () => Promise.resolve(false),
  admin: () =>
    Promise.resolve({
      from(table: string) {
        const data =
          table === "oauth_grants"
            ? grantRow
            : table === "ai_integrations"
              ? integrationRow
              : clientRow;
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data, error: null }),
        };
        return builder;
      },
    }),
}));

async function authenticate() {
  const { authenticateOauthRequest } = await import("@/lib/ai-integrations/oauth-auth.server");
  return authenticateOauthRequest(
    new Request(`${ORIGIN}/api/public/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
    }),
    null,
  );
}

beforeEach(() => {
  payload = {
    sub: "user-1",
    iid: "int-1",
    grant_id: "grant-1",
    client_id: "client-1",
    provider: "claude",
    scopes: ["karriere.status.read", "karriere.workflow.run"],
    jti: "jti-1",
  };
  grantRow = {
    id: "grant-1",
    status: "active",
    user_id: "user-1",
    ai_integration_id: "int-1",
    client_id: "client-row-1",
    scopes: ["karriere.status.read", "karriere.workflow.run"],
  };
  integrationRow = { id: "int-1", status: "active", provider: "claude", user_id: "user-1" };
  clientRow = { client_id: "client-1", is_active: true, expires_at: null };
});

describe("bare active integrasjoner får adgang", () => {
  it("active tillates", async () => {
    const result = await authenticate();
    expect(result.ok).toBe(true);
  });

  for (const status of ["draft", "connecting", "degraded", "disconnected"]) {
    it(`${status} avvises`, async () => {
      integrationRow = { ...integrationRow!, status };
      const result = await authenticate();
      expect(result).toEqual({ ok: false, status: 401, error: "invalid_token" });
    });
  }
});

describe("scope kryssjekkes mot grantet ved hvert kall", () => {
  it("innsnevret grant avviser et token med et scope som er trukket tilbake", async () => {
    grantRow = { ...grantRow!, scopes: ["karriere.status.read"] };
    const result = await authenticate();
    expect(result).toEqual({ ok: false, status: 401, error: "invalid_token" });
  });

  it("effektive scopes er skjæringsmengden med grantet", async () => {
    payload = { ...payload, scopes: ["karriere.status.read"] };
    const result = await authenticate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scopes).toEqual(["karriere.status.read"]);
  });

  it("grant uten scopes avvises", async () => {
    grantRow = { ...grantRow!, scopes: [] };
    const result = await authenticate();
    expect(result.ok).toBe(false);
  });

  it("inaktivt grant avvises", async () => {
    grantRow = { ...grantRow!, status: "revoked" };
    const result = await authenticate();
    expect(result.ok).toBe(false);
  });
});
