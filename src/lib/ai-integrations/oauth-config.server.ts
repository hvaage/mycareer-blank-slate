// ============================================================
// Kanonisk OAuth-konfigurasjon — server-only.
//
// Issuer og resource utledes ALDRI fra Host eller x-forwarded-host.
// De kommer fra én eksplisitt miljøvariabel, PUBLIC_APP_ORIGIN, slik at
// en forfalsket Host-header ikke kan flytte discovery eller audience.
// ============================================================

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 60 minutter
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dager
export const OAUTH_CODE_TTL_SECONDS = 60; // 60 sekunder
export const OAUTH_CONSENT_STATE_TTL_SECONDS = 10 * 60; // 10 minutter

/** Stiene er faste. Discovery annonserer nøyaktig disse. */
export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  token: "/api/public/oauth/token",
  revoke: "/api/public/oauth/revoke",
  register: "/api/public/oauth/register",
  /**
   * Den beskyttede ressursen er MCP-endepunktet. Kanonisk resource er
   * nøyaktig denne strengen, og REST-rutene under
   * /api/public/ai-integrations/v1 er bare et kompatibilitetslag over
   * samme domenelag — de er ikke en egen OAuth-ressurs.
   */
  resource: "/api/public/mcp",
} as const;

/**
 * Den beskyttede MCP-ressursen har to gyldige URL-er: den kanoniske
 * /api/public/mcp og aliaset /mcp. Begge identifiserer NØYAKTIG samme
 * ressurs med samme scopes og samme tilgangskontroll. Audience-regelen
 * svekkes ikke: et token må fortsatt ha `aud` lik én av disse to eksakte
 * strengene — ingen prefiksmatching, ingen verdier utledet fra Host.
 */
export const OAUTH_RESOURCE_PATHS = [OAUTH_PATHS.resource, "/mcp"] as const;

/** De eksakte, gyldige resource-identifikatorene for MCP-ressursen. */
export function mcpResourceIdentifiers(origin: string): string[] {
  return OAUTH_RESOURCE_PATHS.map((path) => `${origin}${path}`);
}

/**
 * Returnerer den forespurte resource-identifikatoren uendret hvis den er
 * en av de gyldige, ellers null. Ingen normalisering: sammenligningen er
 * eksakt.
 */
export function resolveMcpResource(origin: string, requested: unknown): string | null {
  if (typeof requested !== "string") return null;
  return mcpResourceIdentifiers(origin).includes(requested) ? requested : null;
}

export type OauthOrigin = { ok: true; origin: string } | { ok: false; reason: string };

/**
 * PUBLIC_APP_ORIGIN må være en ren HTTPS-origin uten sti, spørring eller
 * fragment. Alt annet er en feilkonfigurasjon og gir 500, ikke en gjetning.
 */
export function normalizePublicOrigin(raw: string | undefined | null): OauthOrigin {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "missing" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.search || url.hash) return { ok: false, reason: "not_origin" };
  if (url.pathname !== "/" && url.pathname !== "") return { ok: false, reason: "not_origin" };
  return { ok: true, origin: url.origin };
}

export function publicAppOrigin(): OauthOrigin {
  return normalizePublicOrigin(process.env["PUBLIC_APP_ORIGIN"]);
}

/** Kanoniske identifikatorer bygget av origin. */
export function oauthUrls(origin: string) {
  return {
    issuer: origin,
    resource: `${origin}${OAUTH_PATHS.resource}`,
    resourcePath: OAUTH_PATHS.resource,
    authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_PATHS.token}`,
    revocation_endpoint: `${origin}${OAUTH_PATHS.revoke}`,
    registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
  };
}

/** Åpen dynamisk klientregistrering er AV med mindre den slås eksplisitt på. */
export function dynamicRegistrationEnabled(): boolean {
  return (process.env["OAUTH_DYNAMIC_REGISTRATION"] ?? "").trim() === "enabled";
}

/** Sett til "1" i utviklingsmiljø for å tillate http/loopback redirect-URI ved DCR. */
export function allowLoopbackRedirects(): boolean {
  return (process.env["OAUTH_ALLOW_LOOPBACK_REDIRECTS"] ?? "").trim() === "1";
}
