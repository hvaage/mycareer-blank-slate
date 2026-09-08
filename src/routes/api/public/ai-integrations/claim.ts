// POST /api/public/ai-integrations/claim
//
// Aktiverer en AI-integrasjon med en engangskode brukeren har hentet i
// Karrierenmin. Ruten er offentlig fordi agenten kaller den uten pålogging.
//
// Sikkerhetskontrakt:
//   - format valideres FØR databasekontakt
//   - koden hashes med SHA-256; klartekst logges aldri og lagres aldri
//   - dobbeltbruk hindres av én atomisk betinget UPDATE (compare-and-set)
//   - alle avvisninger er generiske og røper ikke hvorfor
//   - capabilities fra klienten IGNORERES fullstendig. Koden beviser samtykke,
//     ikke plattformens faktiske egenskaper. Claim lagrer alltid tomme,
//     ubekreftede capabilities. «Forbindelsen er aktiv» er derfor ikke det
//     samme som «egenskapene er bekreftet». Oppgradering krever en senere
//     serverkontrollert verifisering/challenge, se
//     docs/operations/ai-integrations-mcp-oauth-spec.md.
//   - effective_mode utledes server-side av de (tomme) bekreftede egenskapene
//   - user_id og integration_id fra forespørselen ignoreres alltid

import { createFileRoute } from "@tanstack/react-router";
import {
  CLAIM_REJECTION,
  parseClaimInput,
  claimCapabilities,
} from "@/lib/ai-integrations/claim-contract";
import { deriveEffectiveMode } from "@/lib/ai-integrations/contract";
import { sha256Hex } from "@/lib/ai-integrations/setup-code";

function misconfigured(): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "server_misconfigured", message: "Backend er ikke ferdig satt opp." },
    },
    { status: 500 },
  );
}

function reject(): Response {
  return Response.json({ ok: false, error: CLAIM_REJECTION }, { status: 400 });
}

export const Route = createFileRoute("/api/public/ai-integrations/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // FASE 1: alle deterministiske serverforutsetninger valideres FØRST,
        // før både databasekontakt og forbruk av engangskoden. En manglende
        // eller for kort AI_INTEGRATION_TOKEN_SECRET skal aldri konsumere
        // koden, aktivere integrasjonen eller skrive en eneste rad.
        const { isTokenRuntimeConfigured } = await import("@/lib/ai-integrations/token.server");
        const { claimClientKey, claimRateCheck, isClaimRateStorageConfigured } =
          await import("@/lib/ai-integrations/claim-rate-limit.server");
        if (!isTokenRuntimeConfigured() || !isClaimRateStorageConfigured()) {
          return misconfigured();
        }

        // Distribuert ratebegrensning. Fail closed ved lagringsfeil.
        const rate = await claimRateCheck(claimClientKey(request));
        if (!rate.allowed) {
          if (rate.reason === "rate_limited") {
            return Response.json(
              {
                ok: false,
                error: { code: "rate_limited", message: "For mange forsøk. Vent litt." },
              },
              { status: 429 },
            );
          }
          return misconfigured();
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return reject();
        }

        const parsed = parseClaimInput(body);
        if (!parsed.ok) return reject();
        const { provider, code } = parsed.value;
        // Klientens capabilities-påstand leses bevisst ikke. Ingen egenskap
        // kan settes til true av en uautentisert klient.
        const capabilities = claimCapabilities();

        const setupCodeHash = await sha256Hex(code);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        // ATOMISITET: én betinget UPDATE. Postgres tillater bare én vinner
        // fordi raden låses av oppdateringen; taperen ser consumed_at satt
        // og får null rader tilbake. Dette er ikke read-then-update, og
        // krever derfor ingen ny databasefunksjon eller migrasjon.
        const { data: session, error: claimError } = await supabaseAdmin
          .from("ai_integration_setup_sessions")
          .update({ consumed_at: nowIso })
          .eq("setup_code_hash", setupCodeHash)
          .eq("provider", provider)
          .is("consumed_at", null)
          .gt("expires_at", nowIso)
          .select("id, user_id, ai_integration_id, provider")
          .maybeSingle();

        if (claimError || !session) return reject();

        const { data: integration } = await supabaseAdmin
          .from("ai_integrations")
          .select("id, user_id, provider, status")
          .eq("id", session.ai_integration_id)
          .eq("user_id", session.user_id)
          .maybeSingle();

        // Feil leverandør på integrasjonen, eller frakoblet integrasjon:
        // koden forblir brukt (fail closed) og svaret er generisk.
        if (
          !integration ||
          integration.provider !== session.provider ||
          integration.status === "disconnected"
        ) {
          return reject();
        }

        const effectiveMode = deriveEffectiveMode(capabilities);
        const { data: activated, error: activateError } = await supabaseAdmin
          .from("ai_integrations")
          .update({
            status: "active",
            capabilities,
            effective_mode: effectiveMode,
            last_verified_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", integration.id)
          .eq("user_id", integration.user_id)
          .select("id, provider, status, effective_mode, capabilities")
          .single();

        if (activateError || !activated) return reject();

        const { issueAgentToken } = await import("@/lib/ai-integrations/token.server");
        const issued = await issueAgentToken({
          integrationId: activated.id as string,
          userId: integration.user_id as string,
          provider,
        });
        if (!issued) return misconfigured();

        // Svaret inneholder ingen e-post, LinkedIn-data, CV-data eller nøkler.
        return Response.json({
          ok: true,
          integration: {
            id: activated.id,
            provider: activated.provider,
            status: activated.status,
            effective_mode: activated.effective_mode,
            capabilities: activated.capabilities,
          },
          capabilities_verified: false,
          integration_token: issued.token,
          token_expires_at: issued.expiresAt.toISOString(),
        });
      },
    },
  },
});
