// ============================================================
// Klientpolicy for OAuth — ren modul, ingen I/O.
//
// To registreringsveier, i prioritert rekkefølge:
//
//   1. CIMD (Client ID Metadata Document) — FORETRUKKET.
//      client_id ER en https-URL som peker på klientens eget
//      metadatadokument. Vi henter dokumentet bare fra eksplisitt
//      tillatte verter og baner. Ingen vilkårlige URL-er.
//
//   2. DCR (RFC 7591) — kompatibilitetsfallback, feature-flagget av.
//      Redirect-URI-er må treffe en eksakt allowliste. Ingen loopback,
//      ingen wildcard, ingen private adresser, ingen suffikstriks.
//
// Copilot og Grok har BEVISST ingen innebygde callbacker. De blokkeres
// for DCR til en faktisk adresse er konfigurert av drift gjennom
// OAUTH_EXTRA_REDIRECT_URIS.
// ============================================================

import { OAUTH_SCOPES, isValidScopeSet } from "./oauth-contract";

// ---------- felles URL-hygiene ----------

const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.local)$/i;

/** Fellesregler som gjelder ALLE https redirect-URI-er vi godtar. */
export function isCleanHttpsUri(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("*")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false; // userinfo
  if (url.hash) return false; // fragment
  if (url.port) return false; // ukjente porter
  if (PRIVATE_HOST.test(url.hostname)) return false;
  // Eksakt tegnlikhet: ingen normalisering skal kunne skjule et triks.
  return url.toString() === value;
}

// ---------- CIMD-policy ----------

export type CimdHostPolicy = {
  host: string;
  /** Eksakte baner. */
  paths?: string[];
  /** Mønster med ett {segment}-felt, uten skråstrek i segmentet. */
  patterns?: RegExp[];
  /** Kun denne klienten får loopback-redirect, og bare etter verifisert metadata. */
  allowLoopbackCallback?: boolean;
  label: string;
};

export const CIMD_HOST_POLICIES: readonly CimdHostPolicy[] = [
  {
    host: "chatgpt.com",
    paths: ["/oauth/client.json"],
    patterns: [/^\/oauth\/[A-Za-z0-9_-]{1,64}\/client\.json$/],
    label: "ChatGPT",
  },
  {
    host: "claude.ai",
    paths: ["/oauth/claude-code-client-metadata"],
    allowLoopbackCallback: true,
    label: "Claude Code",
  },
] as const;

export type CimdUrlCheck =
  | { ok: true; url: string; policy: CimdHostPolicy }
  | { ok: false; reason: string };

/** client_id som CIMD-URL. Kun https, kjent vert, kjent bane, ingen støy. */
export function checkCimdUrl(value: unknown): CimdUrlCheck {
  if (typeof value !== "string" || !value.startsWith("https://")) {
    return { ok: false, reason: "not_https" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  if (url.hash) return { ok: false, reason: "fragment" };
  if (url.search) return { ok: false, reason: "query" };
  if (url.port) return { ok: false, reason: "port" };

  const policy = CIMD_HOST_POLICIES.find((p) => p.host === url.hostname);
  if (!policy) return { ok: false, reason: "unknown_host" };

  const pathOk =
    (policy.paths ?? []).includes(url.pathname) ||
    (policy.patterns ?? []).some((re) => re.test(url.pathname));
  if (!pathOk) return { ok: false, reason: "unknown_path" };

  // Normalisert form må være identisk med det vi fikk inn.
  if (url.toString() !== value) return { ok: false, reason: "not_normalized" };
  return { ok: true, url: value, policy };
}

/** Claude Code-loopback: eksakt vert og bane, port er tilfeldig. */
export function isClaudeLoopbackRedirect(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password || url.hash || url.search) return false;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  if (url.pathname !== "/callback") return false;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export type CimdMetadata = {
  client_id?: unknown;
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
};

export type CimdValidation =
  | { ok: true; clientName: string; redirectUris: string[]; scopes: string[] }
  | { ok: false; reason: string };

const ALLOWED_GRANTS = new Set(["authorization_code", "refresh_token"]);

/**
 * Metadataen får ALDRI utvide serverens egne tillatelser: ukjente
 * grant/response types, klientautentisering eller scopes utenfor
 * allowlisten avviser hele dokumentet.
 */
export function validateCimdMetadata(
  metadata: CimdMetadata,
  context: { url: string; policy: CimdHostPolicy },
): CimdValidation {
  if (metadata.client_id !== undefined && metadata.client_id !== context.url) {
    return { ok: false, reason: "client_id_mismatch" };
  }
  if (
    metadata.token_endpoint_auth_method !== undefined &&
    metadata.token_endpoint_auth_method !== "none"
  ) {
    return { ok: false, reason: "confidential_client" };
  }
  const grants = metadata.grant_types;
  if (grants !== undefined) {
    if (!Array.isArray(grants) || grants.some((g) => !ALLOWED_GRANTS.has(String(g)))) {
      return { ok: false, reason: "grant_types" };
    }
  }
  const responses = metadata.response_types;
  if (responses !== undefined) {
    if (!Array.isArray(responses) || responses.some((r) => r !== "code")) {
      return { ok: false, reason: "response_types" };
    }
  }

  const name = typeof metadata.client_name === "string" ? metadata.client_name.trim() : "";
  const clientName = name && name.length <= 120 ? name : context.policy.label;

  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) {
    return { ok: false, reason: "redirect_uris" };
  }
  if (new Set(uris.map(String)).size !== uris.length) {
    return { ok: false, reason: "redirect_uris_duplicate" };
  }
  for (const uri of uris) {
    const httpsOk = isCleanHttpsUri(uri) && new URL(String(uri)).hostname === context.policy.host;
    const loopbackOk =
      context.policy.allowLoopbackCallback === true && isClaudeLoopbackRedirect(uri);
    if (!httpsOk && !loopbackOk) return { ok: false, reason: "redirect_uri_rejected" };
  }

  let scopes: string[] = [...OAUTH_SCOPES];
  if (typeof metadata.scope === "string" && metadata.scope.trim() !== "") {
    scopes = metadata.scope.trim().split(/\s+/);
    if (!isValidScopeSet(scopes)) return { ok: false, reason: "scope" };
  }

  return { ok: true, clientName, redirectUris: uris.map(String), scopes };
}

// ---------- DCR-allowliste ----------

/** Dokumenterte, innebygde callbacker. Ingen andre er innebygd. */
export const DCR_EXACT_REDIRECTS: readonly string[] = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
] as const;

/** ChatGPT callback-modus: https://chatgpt.com/connector/oauth/{callback_id} */
export const DCR_PATTERN_REDIRECTS: readonly { host: string; pattern: RegExp }[] = [
  { host: "chatgpt.com", pattern: /^\/connector\/oauth\/[A-Za-z0-9_-]{1,64}$/ },
] as const;

/**
 * Driftsstyrt utvidelse. Mellomrom- eller kommaseparerte eksakte https-URL-er.
 * Dette er den eneste veien inn for Microsoft Copilot og Grok: vi dikter
 * ikke opp et Microsoft- eller xAI-domene.
 */
export function parseExtraRedirectAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && isCleanHttpsUri(s));
}

export function isAllowlistedDcrRedirect(value: unknown, extraAllowlist: string[] = []): boolean {
  if (!isCleanHttpsUri(value)) return false;
  if (DCR_EXACT_REDIRECTS.includes(value)) return true;
  if (extraAllowlist.includes(value)) return true;
  const url = new URL(value);
  return DCR_PATTERN_REDIRECTS.some((r) => r.host === url.hostname && r.pattern.test(url.pathname));
}
