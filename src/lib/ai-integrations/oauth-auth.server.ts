// ============================================================
// Autentisering av OAuth-kall mot agent-API-et — server-only.
//
// Kontrollerer i denne rekkefølgen:
//   1. signatur og format (egen OAuth-hemmelighet)
//   2. issuer, audience/resource, iat/nbf og utløp (±60 sekunder skeivhet)
//   3. scope
//   4. revokering, grantstatus, klientstatus, integrasjonsstatus og
//      at tokenets provider og integrasjon stemmer med databasen
// Tokenet logges aldri og legges aldri i en URL.
// ============================================================

import { oauthUrls, publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";
import { verifyOauthAccessToken } from "@/lib/ai-integrations/oauth-access-token.server";
import { admin, isRevoked } from "@/lib/ai-integrations/oauth-store.server";

export type OauthAuthResult =
  | { ok: true; userId: string; integrationId: string; grantId: string; scopes: string[] }
  | { ok: false; status: number; error: string };

const invalid: OauthAuthResult = { ok: false, status: 401, error: "invalid_token" };

/**
 * `requiredScope = null` autentiserer uten å kreve et bestemt scope. Det
 * brukes av MCP-transporten, som må kunne svare på initialize/tools/list
 * med et gyldig token og deretter håndheve scope per verktøy.
 */
export async function authenticateOauthRequest(
  request: Request,
  requiredScope: string | null,
): Promise<OauthAuthResult> {
  const origin = publicAppOrigin();
  if (!origin.ok) return { ok: false, status: 500, error: "server_error" };
  const urls = oauthUrls(origin.origin);

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return invalid;

  const verified = await verifyOauthAccessToken(header.slice(7).trim(), {
    resource: urls.resource,
    issuer: urls.issuer,
    ...(requiredScope ? { requiredScope } : {}),
  });
  if (!verified.ok) {
    if (verified.reason === "not_configured")
      return { ok: false, status: 500, error: "server_error" };
    if (verified.reason === "scope") return { ok: false, status: 403, error: "insufficient_scope" };
    return invalid;
  }

  const payload = verified.payload;
  if (await isRevoked(payload.jti, payload.grant_id)) return invalid;

  const db = await admin();
  const [{ data: grant }, { data: integration }] = await Promise.all([
    db
      .from("oauth_grants")
      .select("id, status, user_id, ai_integration_id, client_id, scopes")
      .eq("id", payload.grant_id)
      .maybeSingle(),
    db
      .from("ai_integrations")
      .select("id, status, provider, user_id")
      .eq("id", payload.iid)
      .maybeSingle(),
  ]);

  if (
    !grant ||
    grant.status !== "active" ||
    grant.user_id !== payload.sub ||
    grant.ai_integration_id !== payload.iid
  ) {
    return invalid;
  }

  // Scope kryssjekkes mot grantets nåværende scopes ved hvert kall. Blir et
  // scope trukket tilbake etter tokenutstedelse, avvises tokenet (fail closed).
  const grantScopes = Array.isArray(grant.scopes) ? (grant.scopes as string[]) : [];
  if (grantScopes.length === 0) return invalid;
  if (payload.scopes.some((scope) => !grantScopes.includes(scope))) return invalid;
  const effectiveScopes = payload.scopes.filter((scope) => grantScopes.includes(scope));
  if (effectiveScopes.length === 0) return invalid;


  // Klienten må fortsatt finnes, være aktiv og ikke utløpt.
  const { data: client } = await db
    .from("oauth_clients")
    .select("id, client_id, is_active, expires_at")
    .eq("id", grant.client_id)
    .maybeSingle();
  const clientRow = client as {
    client_id: string;
    is_active: boolean;
    expires_at: string | null;
  } | null;
  if (!clientRow || !clientRow.is_active || clientRow.client_id !== payload.client_id) {
    return invalid;
  }
  if (clientRow.expires_at && new Date(clientRow.expires_at).getTime() <= Date.now()) {
    return invalid;
  }

  // Integrasjonen må være i bruk, eid av samme bruker, og providerbindingen
  // i tokenet må stemme med databasen.
  const integrationRow = integration as {
    status: string;
    provider: string;
    user_id: string;
  } | null;
  if (
    !integrationRow ||
    !["connecting", "active", "degraded"].includes(integrationRow.status) ||
    integrationRow.user_id !== payload.sub ||
    integrationRow.provider !== payload.provider
  ) {
    return invalid;
  }

  return {
    ok: true,
    userId: payload.sub,
    integrationId: payload.iid,
    grantId: payload.grant_id,
    scopes: payload.scopes,
  };
}
