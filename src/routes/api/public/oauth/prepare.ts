// POST /api/public/oauth/prepare
//
// Validerer en authorization request FØR brukeren ser samtykkesiden.
// Ruten er offentlig fordi den kalles av samtykkesiden før innlogging,
// men den røper ingenting utover klientens navn og hvilke scopes som
// er bedt om — alt sammen data klienten selv sendte inn.
//
// Ved suksess returneres et signert, kortlivet request-token. Alle
// senere steg bruker det tokenet, aldri rå parametre fra nettleseren.

import { createFileRoute } from "@tanstack/react-router";
import {
  oauthUrls,
  publicAppOrigin,
  mcpResourceIdentifiers,
  OAUTH_CONSENT_STATE_TTL_SECONDS,
} from "@/lib/ai-integrations/oauth-config.server";
import {
  errorRedirectUrl,
  SCOPE_DESCRIPTIONS,
  validateAgainstClient,
  validateAuthorizeShape,
  type AuthorizeParams,
} from "@/lib/ai-integrations/oauth-request";
import { sealAuthorizeRequest, sealReturnState } from "@/lib/ai-integrations/oauth-state.server";
import { loadClientForRequest } from "@/lib/ai-integrations/oauth-store.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const Route = createFileRoute("/api/public/oauth/prepare")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = publicAppOrigin();
        if (!origin.ok) {
          return Response.json(
            { ok: false, error: "server_error" },
            { status: 500, headers: noStore },
          );
        }
        const urls = oauthUrls(origin.origin);

        let body: AuthorizeParams;
        try {
          body = (await request.json()) as AuthorizeParams;
        } catch {
          return Response.json(
            { ok: false, error: "invalid_request", redirectable: false },
            { status: 400, headers: noStore },
          );
        }

        const shape = validateAuthorizeShape(body);
        if (!shape.ok) {
          return Response.json(
            { ok: false, error: shape.error.error, description: shape.error.description },
            { status: 400, headers: noStore },
          );
        }

        const client = await loadClientForRequest(shape.value.client_id);
        const checked = validateAgainstClient(shape.value, client, mcpResourceIdentifiers(origin.origin));
        if (!checked.ok) {
          // Bare når redirect_uri allerede er bekreftet eksakt kan feilen
          // sendes tilbake til klienten. Ellers vises den som side.
          const redirect = checked.error.redirectable
            ? errorRedirectUrl(
                shape.value.redirect_uri,
                checked.error.error,
                shape.value.state,
                urls.issuer,
              )
            : null;
          return Response.json(
            {
              ok: false,
              error: checked.error.error,
              description: checked.error.description,
              redirect_url: redirect,
            },
            { status: 400, headers: noStore },
          );
        }

        const requestToken = await sealAuthorizeRequest({
          client_row_id: client!.id,
          client_id: client!.client_id,
          client_name: client!.client_name,
          redirect_uri: checked.value.redirect_uri,
          scopes: checked.value.scopes,
          state: checked.value.state,
          resource: checked.value.resource,
          code_challenge: checked.value.code_challenge,
        });
        if (!requestToken) {
          return Response.json(
            { ok: false, error: "server_error" },
            { status: 500, headers: noStore },
          );
        }

        return Response.json(
          {
            ok: true,
            request_token: requestToken,
            expires_in: OAUTH_CONSENT_STATE_TTL_SECONDS,
            client_name: client!.client_name,
            scopes: checked.value.scopes.map((scope) => ({
              scope,
              description: SCOPE_DESCRIPTIONS[scope] ?? scope,
            })),
            // Returtilstanden er signert, kortlivet og bare gyldig for
            // ruter på allowlisten. Aldri en rå adresse fra klienten.
            return_state: await sealReturnState(
              typeof (body as { return_path?: unknown }).return_path === "string"
                ? (body as { return_path: string }).return_path
                : "/oauth/authorize",
            ),
          },
          { headers: noStore },
        );
      },
    },
  },
});
