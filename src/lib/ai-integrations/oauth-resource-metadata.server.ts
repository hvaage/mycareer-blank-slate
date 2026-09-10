// Delt RFC 9728-metadata for den beskyttede MCP-ressursen — server-only.
//
// Ressursen har to gyldige URL-er (/api/public/mcp og /mcp). Hvert
// metadata-dokument oppgir nøyaktig den identifikatoren klienten spurte
// om, slik at klienten binder tokenet til den URL-en den faktisk bruker.
// Origin kommer utelukkende fra PUBLIC_APP_ORIGIN — aldri fra Host.

import { OAUTH_SCOPES } from "@/lib/ai-integrations/oauth-contract";
import { publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";

export function protectedResourceMetadataResponse(resourcePath: string): Response {
  const origin = publicAppOrigin();
  if (!origin.ok) return Response.json({ error: "server_error" }, { status: 500 });
  return Response.json(
    {
      resource: `${origin.origin}${resourcePath}`,
      authorization_servers: [origin.origin],
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
}
