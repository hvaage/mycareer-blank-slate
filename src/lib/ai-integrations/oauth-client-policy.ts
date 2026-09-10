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

/** Den ene metadata-adressen som kan gi portagnostisk loopback. */
export const CLAUDE_CIMD_URL = "https://claude.ai/oauth/claude-code-client-metadata";

function loopbackShape(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.username || url.password || url.hash || url.search) return null;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  if (url.pathname !== "/callback") return null;
  return url;
}

/**
 * Metadata-mal slik Anthropic faktisk publiserer den: UTEN port.
 *   http://localhost/callback
 *   http://127.0.0.1/callback
 */
export function isClaudeLoopbackTemplate(value: unknown): boolean {
  const url = loopbackShape(value);
  return url !== null && url.port === "";
}

/** Faktisk redirect i authorize-forespørselen: samme vert/bane, men med ephemeral port. */
export function isClaudeLoopbackRedirect(value: unknown): boolean {
  const url = loopbackShape(value);
  if (!url) return false;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/** Malen og den faktiske adressen må ha samme vert og bane. */
export function loopbackMatchesTemplate(requested: unknown, template: unknown): boolean {
  if (!isClaudeLoopbackRedirect(requested) || !isClaudeLoopbackTemplate(template)) return false;
  const a = new URL(String(requested));
  const b = new URL(String(template));
  return a.hostname === b.hostname && a.pathname === b.pathname;
}

export type LoopbackClientContext = {
  registration_method?: string | null;
  client_id?: string | null;
  metadata_url?: string | null;
  redirect_uris?: unknown;
};

/**
 * Portagnostisk loopback-match er KUN tillatt for den verifiserte
 * Claude Code-CIMD-klienten, og bare mot portløse maler som kom fra
 * det verifiserte metadatadokumentet. DCR, manual og alle andre
 * CIMD-klienter må ha eksakt redirect-match.
 */
export function allowsPortAgnosticLoopback(client: LoopbackClientContext | null): boolean {
  if (!client) return false;
  return (
    client.registration_method === "cimd" &&
    client.client_id === CLAUDE_CIMD_URL &&
    client.metadata_url === CLAUDE_CIMD_URL
  );
}

/**
 * Fullstendig redirect-regel for authorize: eksakt treff for alle,
 * pluss portagnostisk loopback for den verifiserte Claude Code-klienten.
 */
export function redirectUriAllowedForClient(
  requested: unknown,
  client: LoopbackClientContext | null,
): boolean {
  if (typeof requested !== "string" || requested === "") return false;
  const registered = Array.isArray(client?.redirect_uris)
    ? (client!.redirect_uris as unknown[]).map(String)
    : [];
  if (registered.includes(requested)) return true;
  if (!allowsPortAgnosticLoopback(client)) return false;
  return registered.some((template) => loopbackMatchesTemplate(requested, template));
}

export type CimdMetadata = {
  client_id?: unknown;
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
};

export type CimdValidation =
  | {
      ok: true;
      clientName: string;
      redirectUris: string[];
      scopes: string[];
      tokenEndpointAuthMethod: ServerTokenAuthMethod;
    }
  | { ok: false; reason: string };

const ALLOWED_GRANTS = new Set(["authorization_code", "refresh_token"]);

// ---------- token endpoint auth method ----------

/**
 * Serveren annonserer og implementerer BARE "none" (public clients + PKCE).
 * private_key_jwt er bevisst ikke implementert.
 */
export const SERVER_TOKEN_AUTH_METHODS = ["none"] as const;
export type ServerTokenAuthMethod = (typeof SERVER_TOKEN_AUTH_METHODS)[number];

/** Fornuftig øvre grense på pluralfeltet. */
export const MAX_TOKEN_AUTH_METHODS = 10;

export type TokenAuthMethodNegotiation =
  | { ok: true; method: ServerTokenAuthMethod }
  | { ok: false; reason: string };

/**
 * Forhandler token-endepunktmetode etter OpenAI-kontrakten: når klienten
 * publiserer pluralfeltet token_endpoint_auth_methods_supported, velges
 * metoden fra skjæringspunktet med serverens metoder. Singularfeltet er
 * legacy og får ikke overstyre et gyldig pluralfelt.
 */
export function negotiateTokenEndpointAuthMethod(
  metadata: Pick<
    CimdMetadata,
    "token_endpoint_auth_method" | "token_endpoint_auth_methods_supported"
  >,
): TokenAuthMethodNegotiation {
  const plural = metadata.token_endpoint_auth_methods_supported;
  if (plural !== undefined) {
    if (!Array.isArray(plural) || plural.length === 0 || plural.length > MAX_TOKEN_AUTH_METHODS) {
      return { ok: false, reason: "token_endpoint_auth_methods" };
    }
    const cleaned: string[] = [];
    for (const entry of plural) {
      if (typeof entry !== "string") return { ok: false, reason: "token_endpoint_auth_methods" };
      // Eksakte protokollidentifikatorer: ingen trimming eller normalisering.
      if (entry === "" || entry.length > 64) {
        return { ok: false, reason: "token_endpoint_auth_methods" };
      }
      cleaned.push(entry);
    }

    if (new Set(cleaned).size !== cleaned.length) {
      return { ok: false, reason: "token_endpoint_auth_methods" };
    }
    const match = (SERVER_TOKEN_AUTH_METHODS as readonly string[]).find((m) =>
      cleaned.includes(m),
    ) as ServerTokenAuthMethod | undefined;
    if (!match) return { ok: false, reason: "confidential_client" };
    return { ok: true, method: match };
  }

  // Legacy: bare fravær eller "none" godtas.
  const singular = metadata.token_endpoint_auth_method;
  if (singular === undefined || singular === "none") return { ok: true, method: "none" };
  return { ok: false, reason: "confidential_client" };
}

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
  const authMethod = negotiateTokenEndpointAuthMethod(metadata);
  if (!authMethod.ok) return { ok: false, reason: authMethod.reason };
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
    // Anthropic publiserer portløse maler; en konkret port godtas også.
    const loopbackOk =
      context.policy.allowLoopbackCallback === true &&
      (isClaudeLoopbackTemplate(uri) || isClaudeLoopbackRedirect(uri));
    if (!httpsOk && !loopbackOk) return { ok: false, reason: "redirect_uri_rejected" };
  }

  let scopes: string[] = [...OAUTH_SCOPES];
  if (typeof metadata.scope === "string" && metadata.scope.trim() !== "") {
    scopes = metadata.scope.trim().split(/\s+/);
    if (!isValidScopeSet(scopes)) return { ok: false, reason: "scope" };
  }

  return {
    ok: true,
    clientName,
    redirectUris: uris.map(String),
    scopes,
    tokenEndpointAuthMethod: authMethod.method,
  };
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
