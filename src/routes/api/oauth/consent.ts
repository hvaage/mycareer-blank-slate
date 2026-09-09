// GET  /api/oauth/consent — henter samtykkegrunnlag for innlogget bruker
// POST /api/oauth/consent — godkjenner eller avviser (aldri via GET)
//
// Sikkerhetskontrakt:
//   - bruker-id kommer fra Supabase-pålogging, aldri fra forespørselen
//   - authorization request leses fra et signert request-token, ikke fra
//     rå parametre i nettleseren
//   - CSRF: servergenerert token bundet til bruker + request-token,
//     satt som HttpOnly/Secure/SameSite=Strict-cookie og speilet i en
//     header klienten må sende tilbake
//   - avslag gir error=access_denied til den allerede validerte
//     redirect_uri, med opprinnelig state
//   - authorization code er tilfeldig; bare SHA-256-hash lagres, TTL 60 sek
//   - koder og tokener logges aldri

import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest, apiFail } from "@/lib/api-auth.server";
import {
  OAUTH_CODE_TTL_SECONDS,
  oauthUrls,
  publicAppOrigin,
} from "@/lib/ai-integrations/oauth-config.server";
import { randomToken, sha256Hex } from "@/lib/ai-integrations/oauth-crypto.server";
import {
  errorRedirectUrl,
  SCOPE_DESCRIPTIONS,
  successRedirectUrl,
} from "@/lib/ai-integrations/oauth-request";
import {
  csrfCookieHeader,
  CSRF_COOKIE_NAME,
  openAuthorizeRequest,
  readCookie,
  sealCsrfToken,
  verifyCsrfToken,
} from "@/lib/ai-integrations/oauth-state.server";
import { admin, eligibleIntegrations } from "@/lib/ai-integrations/oauth-store.server";
import { isClaudeLoopbackRedirect } from "@/lib/ai-integrations/oauth-client-policy";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const Route = createFileRoute("/api/oauth/consent")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;

        const requestToken = new URL(request.url).searchParams.get("request_token") ?? "";
        const sealed = await openAuthorizeRequest(requestToken);
        if (!sealed) return apiFail(400, "invalid_request", "Forespørselen er utløpt.");

        const csrf = await sealCsrfToken(auth.userId, requestToken);
        if (!csrf) return apiFail(500, "server_misconfigured", "Backend er ikke satt opp.");

        const integrations = await eligibleIntegrations(auth.userId);
        return Response.json(
          {
            ok: true,
            client_name: sealed.client_name,
            scopes: sealed.scopes.map((scope) => ({
              scope,
              description: SCOPE_DESCRIPTIONS[scope] ?? scope,
            })),
            integrations,
            csrf_token: csrf,
            redirect_uri: sealed.redirect_uri,
            // Loopback betyr at koden sendes til et program som kjører på
            // brukerens egen maskin. Det vises tydelig på samtykkesiden.
            loopback_redirect: isClaudeLoopbackRedirect(sealed.redirect_uri),
          },
          { headers: { ...noStore, "Set-Cookie": csrfCookieHeader(csrf) } },
        );
      },

      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;

        const origin = publicAppOrigin();
        if (!origin.ok) return apiFail(500, "server_misconfigured", "Backend er ikke satt opp.");
        const urls = oauthUrls(origin.origin);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return apiFail(400, "invalid_body", "Kunne ikke lese forespørselen.");
        }

        const requestToken = typeof body["request_token"] === "string" ? body["request_token"] : "";
        const sealed = await openAuthorizeRequest(requestToken);
        if (!sealed) return apiFail(400, "invalid_request", "Forespørselen er utløpt.");

        const csrfOk = await verifyCsrfToken(
          request.headers.get("x-oauth-csrf"),
          readCookie(request, CSRF_COOKIE_NAME),
          auth.userId,
          requestToken,
        );
        if (!csrfOk) return apiFail(403, "csrf_failed", "Sikkerhetskontrollen slo ut. Prøv igjen.");

        const decision = body["decision"];
        if (decision !== "approve" && decision !== "deny") {
          return apiFail(400, "invalid_input", "Ukjent valg.");
        }

        if (decision === "deny") {
          return Response.json(
            {
              ok: true,
              redirect_url: errorRedirectUrl(
                sealed.redirect_uri,
                "access_denied",
                sealed.state,
                urls.issuer,
              ),
            },
            { headers: noStore },
          );
        }

        // Kontoknytning: integrasjonen velges av den innloggede brukeren.
        // Verdien fra klienten sjekkes alltid mot brukerens egne rader.
        const integrations = await eligibleIntegrations(auth.userId);
        if (integrations.length === 0) {
          return apiFail(409, "no_integration", "Du har ingen aktiv assistent å koble til.");
        }
        const requested = body["integration_id"];
        const chosen =
          typeof requested === "string"
            ? integrations.find((row) => row.id === requested)
            : integrations.length === 1
              ? integrations[0]
              : undefined;
        if (!chosen) {
          return apiFail(
            400,
            "integration_required",
            "Velg hvilken assistent som skal kobles til.",
          );
        }

        const code = randomToken(32);
        const codeHash = await sha256Hex(code);
        const db = await admin();
        const { error } = await db.from("oauth_authorization_codes").insert({
          code_hash: codeHash,
          client_id: sealed.client_row_id,
          user_id: auth.userId,
          ai_integration_id: chosen.id,
          redirect_uri: sealed.redirect_uri,
          scopes: sealed.scopes,
          code_challenge: sealed.code_challenge,
          code_challenge_method: "S256",
          resource: sealed.resource,
          expires_at: new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1000).toISOString(),
        });
        if (error) return apiFail(500, "database_error", "Kunne ikke fullføre godkjenningen.");

        return Response.json(
          {
            ok: true,
            redirect_url: successRedirectUrl(sealed.redirect_uri, code, sealed.state, urls.issuer),
          },
          // Cookien ryddes: samtykket er brukt opp.
          { headers: { ...noStore, "Set-Cookie": csrfCookieHeader("", 0) } },
        );
      },
    },
  },
});
