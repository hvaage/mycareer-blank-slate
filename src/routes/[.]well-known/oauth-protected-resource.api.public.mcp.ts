// GET /.well-known/oauth-protected-resource/api/public/mcp (RFC 9728 §3.1)
//
// Ressurs-spesifikk metadata. MCP-klienter setter ressursens sti bak
// well-known-prefikset, slik WWW-Authenticate fra /api/public/mcp peker.
// Origin kommer utelukkende fra PUBLIC_APP_ORIGIN — aldri fra Host.

import { createFileRoute } from "@tanstack/react-router";
import { OAUTH_SCOPES } from "@/lib/ai-integrations/oauth-contract";
import { oauthUrls, publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/api/public/mcp")({
  server: {
    handlers: {
      GET: async () => {
        const origin = publicAppOrigin();
        if (!origin.ok) return Response.json({ error: "server_error" }, { status: 500 });
        const urls = oauthUrls(origin.origin);
        return Response.json(
          {
            resource: urls.resource,
            authorization_servers: [urls.issuer],
            scopes_supported: [...OAUTH_SCOPES],
            bearer_methods_supported: ["header"],
            resource_documentation: `${origin.origin}/personvern`,
          },
          {
            headers: {
              "Cache-Control": "public, max-age=300",
              "Content-Type": "application/json",
            },
          },
        );
      },
    },
  },
});
