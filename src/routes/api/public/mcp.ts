// ============================================================
// POST /api/public/mcp — kanonisk Streamable HTTP MCP-transport.
//
// Selve logikken ligger i den delte, server-only modulen
// `mcp-http.server.ts`. Aliaset /mcp bruker nøyaktig samme handler.
// Ruten beholdes uendret av hensyn til bakoverkompatibilitet: den er
// fortsatt den kanoniske OAuth-ressursen.
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import { MCP_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleMcpPost } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpPost(request, MCP_ENDPOINT_PATH);
      },
      GET: async () => {
        const { handleMcpMethodNotAllowed } = await import(
          "@/lib/ai-integrations/mcp-http.server"
        );
        return handleMcpMethodNotAllowed();
      },
      DELETE: async () => {
        const { handleMcpMethodNotAllowed } = await import(
          "@/lib/ai-integrations/mcp-http.server"
        );
        return handleMcpMethodNotAllowed();
      },
      OPTIONS: async ({ request }) => {
        const { handleMcpOptions } = await import("@/lib/ai-integrations/mcp-http.server");
        return handleMcpOptions(request);
      },
    },
  },
});
