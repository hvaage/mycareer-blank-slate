// POST /api/public/oauth/token
//
// Kun application/x-www-form-urlencoded. Kun public clients
// (token_endpoint_auth_method=none). Konfidensielle klienter avvises.
//
// INVARIANTER
//   1. Signeringshemmeligheten kontrolleres FØR databasen berøres.
//      Uten den svarer vi 500 uten å bruke opp koden eller rotere
//      refresh-tokenet. Klienten mister derfor aldri både gammelt og
//      nytt token fordi signeringen feilet etterpå.
//   2. Resource følger requesten fra authorize, gjennom den lagrede
//      koden, og ender som aud i tokenet. Sammenligning er eksakt.
//   3. Første vellykkede innløsing setter integrasjonen connecting ->
//      active i SAMME transaksjon som koden konsumeres. Capabilities
//      røres aldri; svaret sier ingenting om egenskaper.
//   4. Gjenbruk av kode eller refresh token gir invalid_grant og en
//      audit-hendelse, men trekker ikke andre aktive grants.
//
// Alle svar har Cache-Control: no-store. Tokener og koder logges aldri.

import { createFileRoute } from "@tanstack/react-router";
import {
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  oauthUrls,
  publicAppOrigin,
} from "@/lib/ai-integrations/oauth-config.server";
import {
  isValidCodeVerifier,
  randomToken,
  readOauthSecret,
  sha256B64Url,
  sha256Hex,
} from "@/lib/ai-integrations/oauth-crypto.server";
import { issueOauthAccessToken } from "@/lib/ai-integrations/oauth-access-token.server";
import { admin, loadClientForRequest } from "@/lib/ai-integrations/oauth-store.server";
import type { AiProvider } from "@/lib/ai-integrations/contract";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(status: number, error: string, description?: string): Response {
  return Response.json(description ? { error, error_description: description } : { error }, {
    status,
    headers: noStore,
  });
}

type RedeemRow = {
  ok: boolean;
  reason: string;
  grant_id: string | null;
  user_id: string | null;
  ai_integration_id: string | null;
  provider: string | null;
  scopes: string[] | null;
};

function firstRow(data: unknown): RedeemRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as RedeemRow) : null;
}

export const Route = createFileRoute("/api/public/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = publicAppOrigin();
        if (!origin.ok) return oauthError(500, "server_error");
        const urls = oauthUrls(origin.origin);

        // INVARIANT 1: preflight før noe som helst konsumeres.
        if (!readOauthSecret()) return oauthError(500, "server_error");

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
          return oauthError(400, "invalid_request", "Bruk application/x-www-form-urlencoded.");
        }
        if (request.headers.get("authorization")) {
          return oauthError(401, "invalid_client");
        }

        let form: URLSearchParams;
        try {
          form = new URLSearchParams(await request.text());
        } catch {
          return oauthError(400, "invalid_request");
        }

        const grantType = form.get("grant_type");
        const clientId = form.get("client_id") ?? "";
        const resource = form.get("resource");
        if (!clientId) return oauthError(401, "invalid_client");
        if (resource !== urls.resource) {
          return oauthError(400, "invalid_target", "Ukjent resource.");
        }

        const client = await loadClientForRequest(clientId);
        if (!client || !client.is_active) return oauthError(401, "invalid_client");
        if (client.client_type !== "public") {
          return oauthError(401, "invalid_client", "Klienttypen støttes ikke.");
        }

        const db = await admin();
        const newRefresh = randomToken(32);
        const newRefreshHash = await sha256Hex(newRefresh);
        const refreshExpiry = new Date(
          Date.now() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
        ).toISOString();

        let row: RedeemRow | null = null;

        if (grantType === "authorization_code") {
          const code = form.get("code") ?? "";
          const redirectUri = form.get("redirect_uri") ?? "";
          const verifier = form.get("code_verifier");
          if (!code || !redirectUri) return oauthError(400, "invalid_request");
          if (!isValidCodeVerifier(verifier)) {
            return oauthError(400, "invalid_grant", "Ugyldig code_verifier.");
          }
          const challenge = await sha256B64Url(verifier);
          const { data, error } = await db.rpc("oauth_redeem_authorization_code_v2", {
            p_code_hash: await sha256Hex(code),
            p_client_row_id: client.id,
            p_redirect_uri: redirectUri,
            p_code_challenge: challenge,
            p_resource: urls.resource,
            p_refresh_token_hash: newRefreshHash,
            p_refresh_expires_at: refreshExpiry,
          });
          if (error) return oauthError(500, "server_error");
          row = firstRow(data);
        } else if (grantType === "refresh_token") {
          const provided = form.get("refresh_token") ?? "";
          if (!provided) return oauthError(400, "invalid_request");
          const { data, error } = await db.rpc("oauth_rotate_refresh_token_v2", {
            p_token_hash: await sha256Hex(provided),
            p_client_row_id: client.id,
            p_new_token_hash: newRefreshHash,
            p_new_expires_at: refreshExpiry,
          });
          if (error) return oauthError(500, "server_error");
          row = firstRow(data);
        } else {
          return oauthError(400, "unsupported_grant_type");
        }

        // Alle avvisninger gir samme generiske invalid_grant.
        if (
          !row ||
          !row.ok ||
          !row.grant_id ||
          !row.user_id ||
          !row.ai_integration_id ||
          !row.provider
        ) {
          return oauthError(400, "invalid_grant");
        }

        const issued = await issueOauthAccessToken({
          integrationId: row.ai_integration_id,
          userId: row.user_id,
          provider: row.provider as AiProvider,
          resource: urls.resource,
          issuer: urls.issuer,
          clientId: client.client_id,
          grantId: row.grant_id,
          scopes: row.scopes ?? [],
        });
        if (!issued) return oauthError(500, "server_error");

        return Response.json(
          {
            access_token: issued.token,
            token_type: "Bearer",
            expires_in: issued.expiresIn,
            refresh_token: newRefresh,
            scope: (row.scopes ?? []).join(" "),
          },
          { headers: noStore },
        );
      },
    },
  },
});
