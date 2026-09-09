// POST /api/public/ai-integrations/v1/run
//
// KOMPATIBILITETSLAG. Den kanoniske transporten er MCP på
// /api/public/mcp (verktøyet `karrierenmin_run`). Ruten bruker nøyaktig
// samme domenelag og samme feilsemantikk.
//
// ÆRLIGHET FRAMFOR FASADE: ingen arbeidsflyt kan startes av en assistent i
// denne fasen. Inntak skjer via signert e-post-webhook og brukerens egen
// LinkedIn-ZIP-import. Ruten later ALDRI som om noe kjørte.

import { createFileRoute } from "@tanstack/react-router";
import { isAgentWorkflowKind } from "@/lib/ai-integrations/claim-contract";

export const Route = createFileRoute("/api/public/ai-integrations/v1/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateAgentRequest, agentFail } =
          await import("@/lib/ai-integrations/agent-auth.server");
        const auth = await authenticateAgentRequest(request);
        if ("error" in auth) return auth.error;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return agentFail(400, "invalid_body", "Kunne ikke lese forespørselen.");
        }

        const kind = (body as Record<string, unknown> | null)?.["workflow_kind"];
        if (!isAgentWorkflowKind(kind)) {
          return agentFail(400, "invalid_input", "Ukjent arbeidsflyt.");
        }

        const { requestWorkflowRun, RUN_ERROR_HTTP_STATUS } =
          await import("@/lib/ai-integrations/agent-domain.server");
        const result = await requestWorkflowRun(auth.integration.userId, kind);
        return Response.json(result, { status: RUN_ERROR_HTTP_STATUS[result.error.code] });
      },
    },
  },
});
