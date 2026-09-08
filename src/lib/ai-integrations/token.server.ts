// ============================================================
// Integrasjonstoken for agentkall — server-only.
//
// Liten, korrekt HMAC-SHA256-signatur via Web Crypto. Ikke JWT-bibliotek.
// Formatet er bevisst enkelt: base64url(payload) + "." + base64url(signatur).
//
// Hemmeligheten AI_INTEGRATION_TOKEN_SECRET leses kun her, kun ved kall,
// og ligger aldri i repoet eller i klientbundelen.
// Tokenet logges aldri, og returneres bare i svaret på en vellykket claim.
// ============================================================

import type { AiProvider } from "@/lib/ai-integrations/contract";

export const AGENT_TOKEN_AUDIENCE = "karrierenmin-agent-v1";
export const AGENT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 dager

export type AgentTokenPayload = {
  /** ai_integrations.id */
  iid: string;
  /** eier av integrasjonen (auth.users.id) */
  sub: string;
  provider: AiProvider;
  aud: string;
  iat: number;
  exp: number;
  /** tilfeldig token-id, gjør hvert token unikt og sporbart */
  jti: string;
};

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readSecret(): string | null {
  const secret = process.env["AI_INTEGRATION_TOKEN_SECRET"];
  // Tjenestenøkkelen skal ALDRI brukes til å signere agenttoken.
  if (!secret || secret.length < 32) return null;
  return secret;
}

async function sign(data: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data) as unknown as ArrayBuffer);
  return new Uint8Array(mac);
}

/** Tidskonstant sammenligning. Lengdeforskjell avsluttes uten tidlig retur på innhold. */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function isTokenRuntimeConfigured(): boolean {
  return readSecret() !== null;
}

export async function issueAgentToken(input: {
  integrationId: string;
  userId: string;
  provider: AiProvider;
  now?: Date;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: Date } | null> {
  const secret = readSecret();
  if (!secret) return null;

  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + (input.ttlSeconds ?? AGENT_TOKEN_TTL_SECONDS);
  const jtiBytes = new Uint8Array(16);
  crypto.getRandomValues(jtiBytes);

  const payload: AgentTokenPayload = {
    iid: input.integrationId,
    sub: input.userId,
    provider: input.provider,
    aud: AGENT_TOKEN_AUDIENCE,
    iat,
    exp,
    jti: b64urlEncode(jtiBytes),
  };

  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = b64urlEncode(await sign(body, secret));
  return { token: `${body}.${signature}`, expiresAt: new Date(exp * 1000) };
}

export type TokenVerification =
  | { ok: true; payload: AgentTokenPayload }
  | {
      ok: false;
      reason: "not_configured" | "malformed" | "bad_signature" | "expired" | "audience";
    };

export async function verifyAgentToken(
  token: string,
  options: { now?: Date; audience?: string } = {},
): Promise<TokenVerification> {
  const secret = readSecret();
  if (!secret) return { ok: false, reason: "not_configured" };

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];

  let expected: Uint8Array;
  let provided: Uint8Array;
  try {
    expected = await sign(body, secret);
    provided = b64urlDecode(signature);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!safeEqual(expected, provided)) return { ok: false, reason: "bad_signature" };

  let payload: AgentTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as AgentTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload?.iid || !payload.sub || !payload.provider || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.aud !== (options.audience ?? AGENT_TOKEN_AUDIENCE)) {
    return { ok: false, reason: "audience" };
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.exp <= nowSeconds) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}
