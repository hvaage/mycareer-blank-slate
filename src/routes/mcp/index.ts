// ============================================================
// POST /mcp — alias for den kanoniske Streamable HTTP MCP-transporten.
//
// ChatGPT kaller denne stien direkte. Den bruker NØYAKTIG samme handler
// som /api/public/mcp: samme OAuth-verifikasjon, samme scope- og
// resource-binding, samme Origin/Accept-herding og samme feilformat.
// Ingen 30x-redirect: en POST ville mistet både body og Authorization.
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import { MCP_ALIAS_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";

export const Route = createFileRoute("/mcp/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleMcpPost } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpPost(request, MCP_ALIAS_ENDPOINT_PATH);
      },
      GET: async () => {
        const { handleMcpMethodNotAllowed } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpMethodNotAllowed();
      },
      DELETE: async () => {
        const { handleMcpMethodNotAllowed } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpMethodNotAllowed();
      },
      OPTIONS: async ({ request }) => {
        const { handleMcpOptions } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpOptions(request);
      },
    },
  },
});
