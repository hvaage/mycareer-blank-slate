import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_TOKEN_AUDIENCE,
  issueAgentToken,
  isTokenRuntimeConfigured,
  verifyAgentToken,
} from "@/lib/ai-integrations/token.server";

const SECRET = "test-secret-som-er-lang-nok-til-a-vaere-gyldig-0123456789";
const INTEGRATION = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  process.env["AI_INTEGRATION_TOKEN_SECRET"] = SECRET;
});
afterEach(() => {
  delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
});

async function mint(overrides: Parameters<typeof issueAgentToken>[0] | null = null) {
  const issued = await issueAgentToken(
    overrides ?? { integrationId: INTEGRATION, userId: USER, provider: "claude" },
  );
  if (!issued) throw new Error("token ble ikke utstedt");
  return issued;
}

describe("integrasjonstoken", () => {
  it("signerer og verifiserer med alle påkrevde felt", async () => {
    const { token } = await mint();
    const result = await verifyAgentToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.iid).toBe(INTEGRATION);
    expect(result.payload.sub).toBe(USER);
    expect(result.payload.provider).toBe("claude");
    expect(result.payload.aud).toBe(AGENT_TOKEN_AUDIENCE);
    expect(result.payload.exp).toBeGreaterThan(result.payload.iat);
    expect(result.payload.jti).toBeTruthy();
  });

  it("gir unik token-id for hvert token", async () => {
    const a = await mint();
    const b = await mint();
    expect(a.token).not.toBe(b.token);
  });

  it("avviser endret signatur og endret innhold", async () => {
    const { token } = await mint();
    const [body, sig] = token.split(".") as [string, string];
    expect((await verifyAgentToken(`${body}.${sig.slice(0, -2)}AB`)).ok).toBe(false);

    const forged = Buffer.from(
      JSON.stringify({
        iid: INTEGRATION,
        sub: USER,
        provider: "claude",
        aud: AGENT_TOKEN_AUDIENCE,
        iat: 1,
        exp: 9_999_999_999,
        jti: "x",
      }),
    ).toString("base64url");
    const tampered = await verifyAgentToken(`${forged}.${sig}`);
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.reason).toBe("bad_signature");
  });

  it("avviser utløpt token", async () => {
    const { token } = await mint({
      integrationId: INTEGRATION,
      userId: USER,
      provider: "grok",
      ttlSeconds: 1,
    });
    const later = new Date(Date.now() + 5_000);
    const result = await verifyAgentToken(token, { now: later });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("avviser feil audience", async () => {
    const { token } = await mint();
    const result = await verifyAgentToken(token, { audience: "en-annen-tjeneste" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("audience");
  });

  it("avviser ødelagt token", async () => {
    for (const bad of ["", "abc", "a.b.c", "...", "eyJ.$$$"]) {
      expect((await verifyAgentToken(bad)).ok).toBe(false);
    }
  });

  it("utsteder ikke token uten egen hemmelighet", async () => {
    delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
    expect(isTokenRuntimeConfigured()).toBe(false);
    expect(await issueAgentToken({ integrationId: INTEGRATION, userId: USER, provider: "gemini" }))
      .toBeNull();
    process.env["AI_INTEGRATION_TOKEN_SECRET"] = "for-kort";
    expect(await issueAgentToken({ integrationId: INTEGRATION, userId: USER, provider: "gemini" }))
      .toBeNull();
  });

  it("bruker aldri tjenestenøkkelen til signering", async () => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "tjenestenokkel-som-aldri-skal-brukes-til-signering";
    const { token } = await mint();
    delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
    process.env["AI_INTEGRATION_TOKEN_SECRET"] = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    expect((await verifyAgentToken(token)).ok).toBe(false);
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  });

  it("inneholder ingen hemmelighet i selve tokenet", async () => {
    const { token } = await mint();
    expect(token).not.toContain(SECRET);
    const body = Buffer.from(token.split(".")[0]!, "base64url").toString("utf8");
    expect(body).not.toContain(SECRET);
  });
});
