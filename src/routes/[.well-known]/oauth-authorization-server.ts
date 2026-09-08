// GET /.well-known/oauth-authorization-server (RFC 8414)
//
// Annonserer BARE det som faktisk er implementert:
//   - authorization_code og refresh_token
//   - PKCE S256 (eneste tillatte metode)
//   - token_endpoint_auth_method=none (kun public clients)
//   - resource-parameter (RFC 8707)
//   - iss i alle authorization responses -> parameteret settes true
// Ingen OIDC, ingen openid/email-scope, ingen userinfo.
// registration_endpoint annonseres kun når DCR faktisk er slått på.

import { createFileRoute } from "@tanstack/react-router";
import { OAUTH_SCOPES } from "@/lib/ai-integrations/oauth-contract";
import {
  dynamicRegistrationEnabled,
  oauthUrls,
  publicAppOrigin,
} from "@/lib/ai-integrations/oauth-config.server";

export const Route = createFileRoute("/(.well-known)/oauth-authorization-server" as never)({
  server: {
    handlers: {
      GET: async () => {
        const origin = publicAppOrigin();
        if (!origin.ok) {
          return Response.json({ error: "server_error" }, { status: 500 });
        }
        const urls = oauthUrls(origin.origin);
        const metadata: Record<string, unknown> = {
          issuer: urls.issuer,
          authorization_endpoint: urls.authorization_endpoint,
          token_endpoint: urls.token_endpoint,
          revocation_endpoint: urls.revocation_endpoint,
          scopes_supported: [...OAUTH_SCOPES],
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          revocation_endpoint_auth_methods_supported: ["none"],
          authorization_response_iss_parameter_supported: true,
          resource_indicators_supported: true,
          service_documentation: `${origin.origin}/personvern`,
        };
        if (dynamicRegistrationEnabled()) {
          metadata["registration_endpoint"] = urls.registration_endpoint;
        }
        return Response.json(metadata, {
          headers: { "Cache-Control": "public, max-age=300", "Content-Type": "application/json" },
        });
      },
    },
  },
});
