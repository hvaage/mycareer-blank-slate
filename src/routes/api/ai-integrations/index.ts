// GET    /api/ai-integrations — innlogget brukers AI-integrasjoner og automatiseringsvalg.
// PUT    /api/ai-integrations — lagrer valgt assistent, oppgitt abonnement og datavalg.
// DELETE /api/ai-integrations — kobler fra en integrasjon. Karrieredata røres aldri.
//
// Sikkerhetskontrakt:
//   - Bearer-token verifiseres før all databasekontakt
//   - user_id fra forespørselen ignoreres alltid; kun verifisert bruker-id brukes
//   - adminklienten lastes først etter autentisering og skrives alltid med eksplisitt user_id
//   - svar inneholder aldri token, engangskoder eller e-postinnhold

import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiRequest, apiFail } from "@/lib/api-auth.server";
import {
  DEFAULT_AUTOMATION_CHOICES,
  deriveEffectiveMode,
  nextIntegrationStatus,
  parseSaveIntegrationInput,
  AI_PROVIDERS,
  type AiCapabilities,
} from "@/lib/ai-integrations/contract";

/**
 * Returnerer en ferdig formatert videresendingsadresse dersom brukeren
 * allerede har en. Selve tokenet forlater aldri serveren alene.
 */
async function readForwardingAddress(userClient: SupabaseClient): Promise<string | null> {
  const domain = process.env["INBOUND_EMAIL_DOMAIN"];
  if (!domain) return null;
  const { data } = await userClient
    .from("email_job_sources")
    .select("inbound_alias_token")
    .eq("intake_mode", "forwarding")
    .not("inbound_alias_token", "is", null)
    .limit(1)
    .maybeSingle();
  const token = (data as { inbound_alias_token?: string } | null)?.inbound_alias_token;
  return token ? `${token}@${domain}` : null;
}

export const Route = createFileRoute("/api/ai-integrations/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;

        const [{ data: integrations, error }, { data: preferences }] = await Promise.all([
          auth.userClient
            .from("ai_integrations")
            .select(
              "id, provider, declared_plan_tier, effective_mode, status, capabilities, last_verified_at, created_at, updated_at",
            )
            .order("updated_at", { ascending: false }),
          auth.userClient
            .from("automation_preferences")
            .select(
              "job_email_import_enabled, career_email_suggestions_enabled, linkedin_export_import_enabled, linkedin_ready_detection_enabled",
            )
            .maybeSingle(),
        ]);

        if (error) return apiFail(500, "database_error", "Kunne ikke hente oppsettet ditt.");

        return Response.json({
          ok: true,
          integrations: integrations ?? [],
          automation: preferences ?? DEFAULT_AUTOMATION_CHOICES,
          forwarding_address: await readForwardingAddress(auth.userClient),
        });
      },

      PUT: async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        if ("error" in auth) return auth.error;
        const { userId } = auth;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiFail(400, "invalid_body", "Kunne ikke lese forespørselen.");
        }

        const parsed = parseSaveIntegrationInput(body);
        if (!parsed.ok) return apiFail(400, "invalid_input", parsed.error);
        const { provider, plan_tier, automation } = parsed.value;
        // Merk: e-postleverandørvalget i grensesnittet lagres ikke i fase 1.
        // Skjemaet har ingen egnet plass for det, og vi finner ikke opp en.

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Datavalgene lagres alltid — også når brukeren ikke har valgt assistent.
        // De skrives først, slik at «velg senere» aldri blokkeres av assistentoppsettet.
        const { error: prefError } = await supabaseAdmin.from("automation_preferences").upsert(
          {
            user_id: userId,
            job_email_import_enabled: automation.job_email_import_enabled,
            career_email_suggestions_enabled: automation.career_email_suggestions_enabled,
            linkedin_export_import_enabled: automation.linkedin_export_import_enabled,
            linkedin_ready_detection_enabled: automation.linkedin_ready_detection_enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

        if (prefError) return apiFail(500, "database_error", "Kunne ikke lagre valgene dine.");

        // «Jeg vil velge senere»: ingen rad i ai_integrations opprettes.
        if (!provider) {
          return Response.json({
            ok: true,
            integration: null,
            automation,
            email_provider_persisted: false,
          });
        }

        // Bekreftede capabilities, status og verifiseringsdata beholdes.
        const { data: existing } = await supabaseAdmin
          .from("ai_integrations")
          .select("id, status, capabilities")
          .eq("user_id", userId)
          .eq("provider", provider)
          .maybeSingle();

        const capabilities = (existing?.capabilities ?? {}) as AiCapabilities;
        // connecting settes bare for ny integrasjon eller ved ny tilkobling
        // etter frakobling. Ellers står status urørt.
        const nextStatus = nextIntegrationStatus(existing?.status ?? null);

        const shared = {
          declared_plan_tier: plan_tier,
          effective_mode: deriveEffectiveMode(capabilities),
          status: nextStatus,
          updated_at: new Date().toISOString(),
        };
        const columns = "id, provider, declared_plan_tier, effective_mode, status, capabilities";

        const { data: saved, error: saveError } = existing
          ? await supabaseAdmin
              .from("ai_integrations")
              .update(shared)
              .eq("id", existing.id)
              .eq("user_id", userId)
              .select(columns)
              .single()
          : await supabaseAdmin
              .from("ai_integrations")
              .insert({ user_id: userId, provider, ...shared })
              .select(columns)
              .single();

        if (saveError || !saved) {
          // Datavalgene ER lagret. Vi skjuler ikke delvis lagring: klienten
          // henter fersk tilstand og viser hva som faktisk gikk gjennom.
          return Response.json(
            {
              ok: false,
              error: {
                code: "partial_failure",
                message:
                  "Valgene for e-post og LinkedIn er lagret, men assistenten ble ikke lagret. Prøv å lagre assistenten på nytt.",
              },
              saved: { automation: true, integration: false },
              automation,
            },
            { status: 207 },
          );
        }

        return Response.json({
          ok: true,
          integration: saved,
          automation,
          email_provider_persisted: false,
        });
      },

      DELETE: async ({ request }) => {
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

        // Frakobling er en statusendring — ingen karrieredata slettes.
        const { data: updated, error } = await supabaseAdmin
          .from("ai_integrations")
          .update({ status: "disconnected", updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("provider", provider)
          .select("id")
          .maybeSingle();

        if (error) return apiFail(500, "database_error", "Kunne ikke koble fra.");

        if (updated?.id) {
          // Ubrukte engangskoder skal ikke overleve frakoblingen.
          await supabaseAdmin
            .from("ai_integration_setup_sessions")
            .update({ consumed_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("ai_integration_id", updated.id)
            .is("consumed_at", null);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
