// POST /api/public/oauth/register (RFC 7591)
//
// AV SOM STANDARD. Uten OAUTH_DYNAMIC_REGISTRATION=enabled svarer ruten
// 404, og registration_endpoint annonseres da heller ikke i discovery.
//
// Når den er slått på:
//   - kun public clients (ingen client_secret utstedes noen gang)
//   - kun HTTPS redirect URI, uten fragment
//   - ingen wildcard, ingen private/loopback-adresser (med mindre
//     OAUTH_ALLOW_LOOPBACK_REDIRECTS=1 i utviklingsmiljø)
//   - distribuert ratebegrensning via den eksisterende atomiske telleren

import { createFileRoute } from "@tanstack/react-router";
import {
  allowLoopbackRedirects,
  dynamicRegistrationEnabled,
} from "@/lib/ai-integrations/oauth-config.server";
import { OAUTH_SCOPES, isValidScopeSet } from "@/lib/ai-integrations/oauth-contract";
import { randomToken } from "@/lib/ai-integrations/oauth-crypto.server";
import { claimRateCheck } from "@/lib/ai-integrations/claim-rate-limit.server";
import { admin } from "@/lib/ai-integrations/oauth-store.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/** Eksporteres for test: én enkelt redirect URI. */
export function isRegistrableRedirectUri(value: unknown, allowLoopback: boolean): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (value.includes("*")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (/userinfo/i.test(url.pathname)) return false;
  if (url.username || url.password) return false;
  const loopback = PRIVATE_HOST.test(url.hostname) || PRIVATE_HOST.test(url.host);
  if (loopback) return allowLoopback;
  return url.protocol === "https:";
}

export const Route = createFileRoute("/api/public/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!dynamicRegistrationEnabled()) {
          return new Response("Not found", { status: 404, headers: noStore });
        }

        const source =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        const rate = await claimRateCheck(`oauth-register:${source}`);
        if (!rate.allowed) {
          return Response.json(
            { error: "invalid_request" },
            { status: rate.reason === "rate_limited" ? 429 : 500, headers: noStore },
          );
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }

        const name = body["client_name"];
        const uris = body["redirect_uris"];
        if (typeof name !== "string" || name.trim() === "" || name.length > 120) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }
        if (
          !Array.isArray(uris) ||
          uris.length === 0 ||
          uris.length > 5 ||
          new Set(uris).size !== uris.length ||
          !uris.every((u) => isRegistrableRedirectUri(u, allowLoopbackRedirects()))
        ) {
          return Response.json(
            { error: "invalid_redirect_uri" },
            { status: 400, headers: noStore },
          );
        }

        const requested =
          typeof body["scope"] === "string"
            ? (body["scope"] as string).trim().split(/\s+/).filter(Boolean)
            : [...OAUTH_SCOPES];
        if (!isValidScopeSet(requested)) {
          return Response.json({ error: "invalid_scope" }, { status: 400, headers: noStore });
        }

        const clientId = `dcr_${randomToken(16)}`;
        const db = await admin();
        const { error } = await db.from("oauth_clients").insert({
          client_id: clientId,
          client_name: name.trim(),
          client_type: "public",
          redirect_uris: uris as string[],
          allowed_scopes: requested,
        });
        if (error) {
          return Response.json(
            { error: "invalid_client_metadata" },
            { status: 400, headers: noStore },
          );
        }

        return Response.json(
          {
            client_id: clientId,
            client_name: name.trim(),
            redirect_uris: uris,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            scope: requested.join(" "),
          },
          { status: 201, headers: noStore },
        );
      },
    },
  },
});
