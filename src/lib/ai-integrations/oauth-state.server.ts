// ============================================================
// Signerte, kortlivede tilstander for autorisasjonsflyten — server-only.
//
// Tre typer, alle HMAC-signert med samme OAuth-hemmelighet, men med
// hvert sitt formålsprefiks slik at de aldri kan byttes om:
//   rt = request token (validert authorization request)
//   rs = return state (hvor brukeren skal tilbake etter innlogging)
//   cs = CSRF-token (bundet til bruker + request token)
// ============================================================

import {
  b64url,
  b64urlDecode,
  hmacSign,
  readOauthSecret,
  timingSafeEqual,
} from "@/lib/ai-integrations/oauth-crypto.server";
import { OAUTH_CONSENT_STATE_TTL_SECONDS } from "@/lib/ai-integrations/oauth-config.server";

type Purpose = "rt" | "rs" | "cs";

async function seal(purpose: Purpose, data: unknown, ttlSeconds: number): Promise<string | null> {
  const secret = readOauthSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ p: purpose, exp, d: data })));
  return `${body}.${await hmacSign(`${purpose}:${body}`, secret)}`;
}

async function open<T>(purpose: Purpose, value: unknown): Promise<T | null> {
  const secret = readOauthSecret();
  if (!secret || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts as [string, string];
  let expected: string;
  try {
    expected = await hmacSign(`${purpose}:${body}`, secret);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as {
      p: string;
      exp: number;
      d: T;
    };
    if (parsed.p !== purpose) return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed.d;
  } catch {
    return null;
  }
}

// ---------- request token ----------

export type SealedAuthorizeRequest = {
  client_row_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: string[];
  state: string;
  resource: string;
  code_challenge: string;
};

export function sealAuthorizeRequest(value: SealedAuthorizeRequest): Promise<string | null> {
  return seal("rt", value, OAUTH_CONSENT_STATE_TTL_SECONDS);
}

export function openAuthorizeRequest(token: unknown): Promise<SealedAuthorizeRequest | null> {
  return open<SealedAuthorizeRequest>("rt", token);
}

// ---------- retur etter innlogging ----------

/**
 * Kun en relativ sti på eget domene, og bare den ene ruten som faktisk
 * er en del av flyten. Aldri en absolutt adresse fra klienten.
 */
const RETURN_ALLOWLIST = ["/oauth/authorize"];

export function isAllowlistedReturnPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const [pathname] = path.split("?");
  return RETURN_ALLOWLIST.includes(pathname ?? "");
}

export async function sealReturnState(path: string): Promise<string | null> {
  if (!isAllowlistedReturnPath(path)) return null;
  return seal("rs", { path }, OAUTH_CONSENT_STATE_TTL_SECONDS);
}

export async function openReturnState(token: unknown): Promise<string | null> {
  const data = await open<{ path: string }>("rs", token);
  if (!data || !isAllowlistedReturnPath(data.path)) return null;
  return data.path;
}

// ---------- CSRF ----------

export function sealCsrfToken(userId: string, requestToken: string): Promise<string | null> {
  return seal("cs", { u: userId, r: requestToken }, OAUTH_CONSENT_STATE_TTL_SECONDS);
}

export async function verifyCsrfToken(
  token: unknown,
  cookieValue: unknown,
  userId: string,
  requestToken: string,
): Promise<boolean> {
  if (typeof token !== "string" || typeof cookieValue !== "string") return false;
  // Dobbel innsending: headerverdi og cookie må være identiske.
  if (!timingSafeEqual(token, cookieValue)) return false;
  const data = await open<{ u: string; r: string }>("cs", token);
  if (!data) return false;
  return data.u === userId && data.r === requestToken;
}

export const CSRF_COOKIE_NAME = "km_oauth_csrf";

export function csrfCookieHeader(value: string, maxAgeSeconds = OAUTH_CONSENT_STATE_TTL_SECONDS) {
  return `${CSRF_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
