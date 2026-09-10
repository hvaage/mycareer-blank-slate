// GET /mcp/.well-known/oauth-protected-resource
//
// Enkelte klienter (blant annet ChatGPT) prøver metadata som et suffiks
// på ressursstien i tillegg til RFC 9728-plasseringen. Dokumentet er
// identisk med /.well-known/oauth-protected-resource/mcp.

import { createFileRoute } from "@tanstack/react-router";
import { MCP_ALIAS_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";

export const Route = createFileRoute("/mcp/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: async () => {
        const { protectedResourceMetadataResponse } =
          await import("@/lib/ai-integrations/oauth-resource-metadata.server");
        return protectedResourceMetadataResponse(MCP_ALIAS_ENDPOINT_PATH);
      },
    },
  },
});
