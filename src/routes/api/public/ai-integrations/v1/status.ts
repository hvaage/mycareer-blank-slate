// GET /api/public/ai-integrations/v1/status
//
// Versjonert agentkontrakt. Tokenet identifiserer integrasjon og bruker;
// user_id og integration_id fra forespørselen leses aldri.
// Svaret inneholder ingen e-post, LinkedIn-data, CV-data eller nøkler.

import { createFileRoute } from "@tanstack/react-router";
import {
  AGENT_WORKFLOW_KINDS,
  WORKFLOW_PREFERENCE_KEY,
  type AgentWorkflowKind,
} from "@/lib/ai-integrations/claim-contract";

export const Route = createFileRoute("/api/public/ai-integrations/v1/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authenticateAgentRequest } =
          await import("@/lib/ai-integrations/agent-auth.server");
        const auth = await authenticateAgentRequest(request);
        if ("error" in auth) return auth.error;
        const { integration } = auth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prefs } = await supabaseAdmin
          .from("automation_preferences")
          .select(
            "job_email_import_enabled, career_email_suggestions_enabled, linkedin_ready_detection_enabled",
          )
          .eq("user_id", integration.userId)
          .maybeSingle();

        const preferences = (prefs ?? {}) as Record<string, boolean | undefined>;
        const workflows = AGENT_WORKFLOW_KINDS.map((kind: AgentWorkflowKind) => ({
          workflow_kind: kind,
          enabled_by_user: preferences[WORKFLOW_PREFERENCE_KEY[kind]] === true,
          // Fase 2 har ingen sikker backendfunksjon for agentutløst kjøring ennå.
          available: false,
        }));

        return Response.json({
          ok: true,
          api_version: "v1",
          integration: {
            provider: integration.provider,
            status: integration.status,
            effective_mode: integration.effectiveMode,
            capabilities: integration.capabilities,
            last_verified_at: integration.lastVerifiedAt,
          },
          workflows,
        });
      },
    },
  },
});
