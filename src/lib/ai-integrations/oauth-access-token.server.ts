// ============================================================
// OAuth access token — server-only.
//
// Bevisst SKILT fra det gamle 30-dagers agenttokenet:
//   - egen hemmelighet (AI_INTEGRATION_OAUTH_SECRET)
//   - typ: "oauth-access" i payload
//   - aud = kanonisk resource, ikke "karrierenmin-agent-v1"
//   - 60 minutters levetid
// Et legacy claim-token kan derfor aldri passere som OAuth-token.
//
// Tokenet logges aldri, legges aldri i URL og returneres bare i
// tokenresponsen.
// ============================================================

import type { AiProvider } from "@/lib/ai-integrations/contract";
import {
  b64url,
  b64urlDecode,
  hmacSign,
  readOauthSecret,
  timingSafeEqual,
} from "@/lib/ai-integrations/oauth-crypto.server";
import { OAUTH_ACCESS_TOKEN_TTL_SECONDS } from "@/lib/ai-integrations/oauth-config.server";

export const OAUTH_TOKEN_TYP = "oauth-access";

export type OauthAccessTokenPayload = {
  typ: typeof OAUTH_TOKEN_TYP;
  /** ai_integrations.id */
  iid: string;
  /** eier av integrasjonen (auth.users.id) */
  sub: string;
  provider: AiProvider;
  /** kanonisk resource-identifikator */
  aud: string;
  resource: string;
  iss: string;
  client_id: string;
  grant_id: string;
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
};

export type IssueInput = {
  integrationId: string;
  userId: string;
  provider: AiProvider;
  resource: string;
  issuer: string;
  clientId: string;
  grantId: string;
  scopes: string[];
  now?: Date;
  ttlSeconds?: number;
};

export async function issueOauthAccessToken(
  input: IssueInput,
): Promise<{ token: string; expiresIn: number; jti: string; expiresAt: Date } | null> {
  const secret = readOauthSecret();
  if (!secret) return null;

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const ttl = input.ttlSeconds ?? OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  const jtiBytes = new Uint8Array(16);
  crypto.getRandomValues(jtiBytes);
  const jti = b64url(jtiBytes);

  const payload: OauthAccessTokenPayload = {
    typ: OAUTH_TOKEN_TYP,
    iid: input.integrationId,
    sub: input.userId,
    provider: input.provider,
    aud: input.resource,
    resource: input.resource,
    iss: input.issuer,
    client_id: input.clientId,
    grant_id: input.grantId,
    scopes: input.scopes,
    iat,
    exp: iat + ttl,
    jti,
  };

  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(body, secret);
  return {
    token: `${body}.${signature}`,
    expiresIn: ttl,
    jti,
    expiresAt: new Date((iat + ttl) * 1000),
  };
}

export type OauthTokenVerification =
  | { ok: true; payload: OauthAccessTokenPayload }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "malformed"
        | "bad_signature"
        | "expired"
        | "not_yet_valid"
        | "issuer"
        | "audience"
        | "scope";
    };

/**
 * Tillatt klokkeskeivhet mellom utsteder og verifikator. 60 sekunder er
 * nok til vanlig NTP-drift, og kort nok til at et token med framtidig
 * iat ikke kan brukes til å forlenge levetiden i praksis.
 */
export const OAUTH_CLOCK_SKEW_SECONDS = 60;

/**
 * Signatur, type, issuer, audience/resource, iat/nbf, utløp og scope.
 * Grant-, klient-, integrasjons- og revokeringsstatus sjekkes i databasen
 * av kalleren (oauth-auth.server.ts).
 */
export async function verifyOauthAccessToken(
  token: string,
  options: { resource: string; issuer: string; now?: Date; requiredScope?: string },
): Promise<OauthTokenVerification> {
  const secret = readOauthSecret();
  if (!secret) return { ok: false, reason: "not_configured" };

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];

  let expected: string;
  try {
    expected = await hmacSign(body, secret);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, signature)) return { ok: false, reason: "bad_signature" };

  let payload: OauthAccessTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as OauthAccessTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    payload?.typ !== OAUTH_TOKEN_TYP ||
    !payload.iid ||
    !payload.sub ||
    !payload.grant_id ||
    !payload.client_id ||
    !payload.provider ||
    !payload.jti ||
    !Array.isArray(payload.scopes) ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.iss !== options.issuer) return { ok: false, reason: "issuer" };
  if (payload.aud !== options.resource || payload.resource !== options.resource) {
    return { ok: false, reason: "audience" };
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  // nbf finnes ikke som eget felt; iat er «ikke gyldig før»-grensen.
  if (payload.iat > nowSeconds + OAUTH_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (payload.exp <= nowSeconds - OAUTH_CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  if (options.requiredScope && !payload.scopes.includes(options.requiredScope)) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true, payload };
}
