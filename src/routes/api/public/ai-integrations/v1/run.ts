// POST /api/public/ai-integrations/v1/run
//
// Ber om en kjøring av en allowlistet arbeidsflyt. Tokenet identifiserer
// integrasjon og bruker; user_id og integration_id fra forespørselen leses aldri.
//
// ÆRLIGHET FRAMFOR FASADE: denne fasen har ingen eksisterende, sikker
// backendfunksjon for agentutløst jobbimport eller karrierelogg. Inntak skjer
// via signert e-post-webhook og brukerens egen LinkedIn-ZIP-import. Ruten
// returnerer derfor eksplisitt not_available og later ALDRI som om noe kjørte.

import { createFileRoute } from "@tanstack/react-router";
import {
  isAgentWorkflowKind,
  WORKFLOW_PREFERENCE_KEY,
} from "@/lib/ai-integrations/claim-contract";

export const Route = createFileRoute("/api/public/ai-integrations/v1/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateAgentRequest, agentFail } = await import(
          "@/lib/ai-integrations/agent-auth.server"
        );
        const auth = await authenticateAgentRequest(request);
        if ("error" in auth) return auth.error;
        const { integration } = auth;

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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prefs } = await supabaseAdmin
          .from("automation_preferences")
          .select(
            "job_email_import_enabled, career_email_suggestions_enabled, linkedin_ready_detection_enabled",
          )
          .eq("user_id", integration.userId)
          .maybeSingle();

        const enabled =
          ((prefs ?? {}) as Record<string, boolean | undefined>)[WORKFLOW_PREFERENCE_KEY[kind]] ===
          true;
        if (!enabled) {
          return agentFail(403, "not_enabled", "Brukeren har ikke slått på denne arbeidsflyten.");
        }

        return Response.json(
          {
            ok: false,
            error: {
              code: "not_available",
              message:
                "Arbeidsflyten kan ikke startes av en assistent ennå. Ingen kjøring ble opprettet.",
            },
            workflow_kind: kind,
          },
          { status: 501 },
        );
      },
    },
  },
});
