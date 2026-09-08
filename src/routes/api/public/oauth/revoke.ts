// POST /api/public/oauth/revoke (RFC 7009)
//
// Idempotent: svaret er 200 uansett om tokenet fantes, var ukjent eller
// allerede var trukket. Ingenting røper hvilken av delene det var.
// Kun public clients, kun form-encoded, alltid no-store.

import { createFileRoute } from "@tanstack/react-router";
import { sha256Hex } from "@/lib/ai-integrations/oauth-crypto.server";
import { verifyOauthAccessToken } from "@/lib/ai-integrations/oauth-access-token.server";
import { oauthUrls, publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";
import { admin, loadClient } from "@/lib/ai-integrations/oauth-store.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const Route = createFileRoute("/api/public/oauth/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = publicAppOrigin();
        if (!origin.ok) {
          return Response.json({ error: "server_error" }, { status: 500, headers: noStore });
        }

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
          return Response.json(
            { error: "invalid_request" },
            { status: 400, headers: noStore },
          );
        }

        let form: URLSearchParams;
        try {
          form = new URLSearchParams(await request.text());
        } catch {
          return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
        }

        const token = form.get("token") ?? "";
        const clientId = form.get("client_id") ?? "";
        if (!token || !clientId) {
          return new Response(null, { status: 200, headers: noStore });
        }

        const client = await loadClient(clientId);
        if (!client || !client.is_active || client.client_type !== "public") {
          return Response.json({ error: "invalid_client" }, { status: 401, headers: noStore });
        }

        const db = await admin();
        const hint = form.get("token_type_hint");

        if (hint !== "access_token") {
          await db.rpc("oauth_revoke_refresh_token", {
            p_token_hash: await sha256Hex(token),
            p_client_row_id: client.id,
          });
        }

        if (hint !== "refresh_token") {
          // Access token er signert; vi trekker grantet det peker på.
          const verified = await verifyOauthAccessToken(token, {
            resource: oauthUrls(origin.origin).resource,
          });
          if (verified.ok && verified.payload.client_id === client.client_id) {
            await db.rpc("oauth_revoke_grants", {
              p_grant_id: verified.payload.grant_id,
              p_ai_integration_id: null,
              p_user_id: null,
              p_reason: "client_revocation",
            });
          }
        }

        return new Response(null, { status: 200, headers: noStore });
      },
    },
  },
});
