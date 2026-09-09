// GET /api/public/ai-integrations/v1/status
//
// KOMPATIBILITETSLAG. Den kanoniske transporten er MCP på
// /api/public/mcp (verktøyet `karrierenmin_status`). Denne ruten beholdes
// for eksisterende integrasjonstokener og bruker NØYAKTIG samme domenelag,
// samme autorisasjonsprinsipp og samme svarinnhold.
//
// Tokenet identifiserer integrasjon og bruker; user_id og integration_id
// fra forespørselen leses aldri. Svaret inneholder ingen e-post,
// LinkedIn-data, CV-data eller nøkler.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/ai-integrations/v1/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authenticateAgentRequest } =
          await import("@/lib/ai-integrations/agent-auth.server");
        const auth = await authenticateAgentRequest(request);
        if ("error" in auth) return auth.error;

        const { getStatus } = await import("@/lib/ai-integrations/agent-domain.server");
        return Response.json(await getStatus(auth.integration));
      },
    },
  },
});
