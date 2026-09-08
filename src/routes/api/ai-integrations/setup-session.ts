// POST /api/ai-integrations/setup-session — lager en kortlivet engangskode.
//
// Sikkerhetskontrakt:
//   - koden lages med kryptografisk tilfeldighet i serverruten
//   - kun SHA-256-hashen lagres; klartekstkoden returneres én gang og logges aldri
//   - tidligere ubrukte koder for samme integrasjon invalideres først
//   - brukeren må eie integrasjonen; user_id fra forespørselen ignoreres

import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiRequest, apiFail } from "@/lib/api-auth.server";
import { AI_PROVIDERS, formatSetupCode, setupCodeExpiry } from "@/lib/ai-integrations/contract";
import { generateSetupCode, sha256Hex } from "@/lib/ai-integrations/setup-code";

export const Route = createFileRoute("/api/ai-integrations/setup-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;
        const { userId } = auth;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiFail(400, "invalid_body", "Kunne ikke lese forespørselen.");
        }

        const provider = (body as Record<string, unknown> | null)?.["provider"];
        if (
          typeof provider !== "string" ||
          !(AI_PROVIDERS as readonly string[]).includes(provider)
        ) {
          return apiFail(400, "invalid_input", "Ukjent assistent.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: integration } = await supabaseAdmin
          .from("ai_integrations")
          .select("id, provider")
          .eq("user_id", userId)
          .eq("provider", provider)
          .maybeSingle();

        if (!integration?.id) {
          return apiFail(404, "not_found", "Sett opp assistenten før du lager en kode.");
        }

        await supabaseAdmin
          .from("ai_integration_setup_sessions")
          .update({ consumed_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("ai_integration_id", integration.id)
          .is("consumed_at", null);

        const code = generateSetupCode();
        const expiresAt = setupCodeExpiry();

        const { error } = await supabaseAdmin.from("ai_integration_setup_sessions").insert({
          user_id: userId,
          ai_integration_id: integration.id,
          provider,
          setup_code_hash: await sha256Hex(code),
          expires_at: expiresAt.toISOString(),
        });

        if (error) return apiFail(500, "database_error", "Kunne ikke lage kode. Prøv igjen.");

        return Response.json({
          ok: true,
          setup_code: formatSetupCode(code),
          expires_at: expiresAt.toISOString(),
        });
      },
    },
  },
});
