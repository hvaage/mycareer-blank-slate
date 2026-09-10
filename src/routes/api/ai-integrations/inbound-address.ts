// ============================================================
// POST   /api/ai-integrations/inbound-address  -> opprett (eller roter) privat importadresse
// DELETE /api/ai-integrations/inbound-address  -> slå av mottak for brukeren
//
// Tokenet genereres kun på serveren. Bruker-id kommer fra Bearer-token,
// aldri fra forespørselens innhold. Én videresendingskilde per bruker
// håndheves av databasen.
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import { apiFail, authenticateApiRequest } from "@/lib/api-auth.server";
import { formatInboundAddress, generateAliasToken } from "@/lib/job-leads/inbound-alias";

const MAX_TOKEN_ATTEMPTS = 5;

export const Route = createFileRoute("/api/ai-integrations/inbound-address")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;
        const { userClient, userId } = auth;

        let rotate = false;
        try {
          const body = (await request.json()) as { rotate?: boolean } | null;
          rotate = body?.rotate === true;
        } catch {
          rotate = false;
        }

        const { inboundIntakeConfig } = await import("@/lib/job-leads/inbound-intake.server");
        const config = inboundIntakeConfig();

        const { data: existing } = await userClient
          .from("email_job_sources")
          .select("id, inbound_alias_token, is_active")
          .eq("user_id", userId)
          .eq("intake_mode", "forwarding")
          .maybeSingle();

        let token = existing?.inbound_alias_token ?? null;

        for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
          if (token && !rotate) break;
          const candidate = generateAliasToken();
          const payload = {
            user_id: userId,
            intake_mode: "forwarding" as const,
            source_system: "other",
            inbound_alias_token: candidate,
            is_active: true,
          };
          const { error } = existing
            ? await userClient
                .from("email_job_sources")
                .update({ inbound_alias_token: candidate, is_active: true })
                .eq("id", existing.id)
                .eq("user_id", userId)
            : await userClient.from("email_job_sources").insert(payload);

          if (!error) {
            token = candidate;
            break;
          }
          if (error.code !== "23505") {
            console.error("[inbound-address] provisioning failed", {
              code: error.code,
              message: error.message,
            });
            return apiFail(500, "provisioning_failed", "Importadressen kunne ikke opprettes.");
          }
          // 23505: kollisjon på token — prøv på nytt med nytt token.
        }

        if (!token) {
          return apiFail(500, "provisioning_failed", "Importadressen kunne ikke opprettes.");
        }

        const address = config.domain ? formatInboundAddress(token, config.domain) : null;

        return Response.json({
          ok: true,
          forwarding_address: address,
          email_intake_status: config.ready && address ? "active" : "pending_setup",
        });
      },

      DELETE: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;
        const { userClient, userId } = auth;

        const { error } = await userClient
          .from("email_job_sources")
          .update({ is_active: false })
          .eq("user_id", userId)
          .eq("intake_mode", "forwarding");

        if (error) {
          console.error("[inbound-address] deactivation failed", {
            code: error.code,
            message: error.message,
          });
          return apiFail(500, "deactivation_failed", "Importadressen kunne ikke slås av.");
        }

        return Response.json({ ok: true, forwarding_address: null, email_intake_status: "off" });
      },
    },
  },
});
