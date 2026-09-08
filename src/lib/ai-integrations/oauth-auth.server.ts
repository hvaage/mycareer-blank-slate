// ============================================================
// Autentisering av OAuth-kall mot agent-API-et — server-only.
//
// Kontrollerer i denne rekkefølgen:
//   1. signatur og format (egen OAuth-hemmelighet)
//   2. audience/resource mot kanonisk identifikator
//   3. utløp
//   4. scope
//   5. grantstatus, integrasjonsstatus og revokering i databasen
// Tokenet logges aldri og legges aldri i en URL.
// ============================================================

import { oauthUrls, publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";
import { verifyOauthAccessToken } from "@/lib/ai-integrations/oauth-access-token.server";
import { admin, isRevoked } from "@/lib/ai-integrations/oauth-store.server";

export type OauthAuthResult =
  | { ok: true; userId: string; integrationId: string; grantId: string; scopes: string[] }
  | { ok: false; status: number; error: string };

export async function authenticateOauthRequest(
  request: Request,
  requiredScope: string,
): Promise<OauthAuthResult> {
  const origin = publicAppOrigin();
  if (!origin.ok) return { ok: false, status: 500, error: "server_error" };

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const verified = await verifyOauthAccessToken(header.slice(7).trim(), {
    resource: oauthUrls(origin.origin).resource,
    requiredScope,
  });
  if (!verified.ok) {
    if (verified.reason === "not_configured")
      return { ok: false, status: 500, error: "server_error" };
    if (verified.reason === "scope") return { ok: false, status: 403, error: "insufficient_scope" };
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const payload = verified.payload;
  if (await isRevoked(payload.jti, payload.grant_id)) {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const db = await admin();
  const [{ data: grant }, { data: integration }] = await Promise.all([
    db
      .from("oauth_grants")
      .select("id, status, user_id, ai_integration_id")
      .eq("id", payload.grant_id)
      .maybeSingle(),
    db.from("ai_integrations").select("id, status").eq("id", payload.iid).maybeSingle(),
  ]);

  if (
    !grant ||
    grant.status !== "active" ||
    grant.user_id !== payload.sub ||
    grant.ai_integration_id !== payload.iid
  ) {
    return { ok: false, status: 401, error: "invalid_token" };
  }
  if (!integration || integration.status === "disconnected") {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  return {
    ok: true,
    userId: payload.sub,
    integrationId: payload.iid,
    grantId: payload.grant_id,
    scopes: payload.scopes,
  };
}
