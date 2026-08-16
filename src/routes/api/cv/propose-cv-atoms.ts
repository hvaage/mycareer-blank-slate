// POST /api/cv/propose-cv-atoms
//
// Fase 3A: runtime- og sikkerhetspreflight.
// Ingen Anthropic-kall, ingen skriving av atomforslag i denne fasen.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - eksplisitt inputvalidering (zod, strict)
//   - user_id i body avvises (aldri brukt)
//   - Supabase-JWT verifiseres server-side (Authorization: Bearer)
//   - user_id hentes kun fra verifisert auth-kontekst
//   - same-origin: Origin/Referer må matche vertsnavnet når header finnes
//   - service-credential brukes først etter at eierskap er håndhevet
//   - sanitert JSON-feilmodell, ingen secrets eller CV-data i logg/respons

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

// Read-only importverifikasjon av kjeden ruten skal bruke i 3B.
import type { ReadinessReport } from "../../../../supabase/functions/_shared/cv-skills/contract.ts";
import { toVendorAtoms } from "../../../../supabase/functions/_shared/cv-skills/adapters/career-atom-adapter.ts";
import { runModelStep } from "../../../../supabase/functions/_shared/cv-skills/step-runner.ts";
import { CLAUDE_RUNTIME, type ClaudeRuntimePort } from "../../../../supabase/functions/_shared/claude/client.ts";

type ErrorCode =
  | "method_not_allowed"
  | "invalid_origin"
  | "invalid_body"
  | "unauthorized"
  | "server_misconfigured"
  | "preflight_failed";

function fail(status: number, code: ErrorCode, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

const bodySchema = z
  .object({
    // 3A: kun preflight. Ingen innholdsfelter ennå.
    dry_run: z.literal(true).optional(),
    correlation_id: z.string().uuid().optional(),
  })
  .strict();

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");
  if (!host) return false;
  const check = (value: string | null) => {
    if (!value) return null;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  const o = check(origin);
  if (o !== null) return o;
  const r = check(referer);
  if (r !== null) return r;
  // Ingen Origin/Referer: tillatt kun fordi auth er bearer-basert (ikke cookie),
  // slik at forespørselen ikke kan forfalskes med brukerens ambient credentials.
  return true;
}

export const Route = createFileRoute("/api/cv/propose-cv-atoms")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const startedAt = Date.now();

        if (!sameOrigin(request)) {
          return fail(403, "invalid_origin", "Forespørselen må komme fra samme opphav.");
        }

        // --- Secrets leses per request (Cloudflare injiserer env ved kall) ---
        const supabaseUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];

        const secretsPresent = {
          supabase_url: Boolean(supabaseUrl),
          supabase_publishable_key: Boolean(publishableKey),
          supabase_service_credential: Boolean(serviceKey),
          anthropic_api_key: Boolean(anthropicKey),
        };

        if (!supabaseUrl || !publishableKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        // --- Inputvalidering ---
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = {};
        }
        if (raw && typeof raw === "object" && "user_id" in (raw as Record<string, unknown>)) {
          return fail(400, "invalid_body", "user_id kan ikke sendes i forespørselen.");
        }
        const parsed = bodySchema.safeParse(raw ?? {});
        if (!parsed.success) {
          return fail(400, "invalid_body", "Ugyldig forespørsel.");
        }

        // --- JWT-verifisering server-side ---
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }
        const token = authHeader.slice("Bearer ".length);

        const userClient = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: userData, error: userError } = await userClient.auth.getUser();
        const userId = userData?.user?.id;
        if (userError || !userId) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }

        // --- Eierskap håndheves før service-klienten brukes ---
        // Alt videre arbeid skjer for denne verifiserte user_id, aldri for en
        // id fra forespørselen.
        let internalRpcOk = false;
        let internalRpcBlockedForUser = false;

        // Authenticated-klient skal IKKE kunne kalle internal_ai_*.
        const asUser = await userClient.rpc("internal_ai_get_job_status" as never, {
          p_user_id: userId,
          p_job_id: "00000000-0000-0000-0000-000000000000",
        } as never);
        internalRpcBlockedForUser = Boolean(asUser.error);

        if (serviceKey) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error: rpcError } = await supabaseAdmin.rpc(
            "internal_ai_get_job_status" as never,
            {
              p_user_id: userId,
              p_job_id: "00000000-0000-0000-0000-000000000000",
            } as never,
          );
          internalRpcOk = !rpcError;
        }

        const runtimePort: ClaudeRuntimePort | null = anthropicKey ? { apiKey: anthropicKey } : null;

        const preflight = {
          method_guard: true,
          input_validation: true,
          jwt_verified: true,
          user_id_from_body_rejected: true,
          same_origin: true,
          csrf_relevant: false as const, // auth er bearer-basert, ikke cookie
          imports: {
            contract: true as const,
            adapter: typeof toVendorAtoms === "function",
            step_runner: typeof runModelStep === "function",
            claude_client: Boolean(CLAUDE_RUNTIME?.apiVersion),
            vendor_runtime: true as const,
          },
          secrets_present: secretsPresent,
          claude_runtime_port_ready: Boolean(runtimePort),
          internal_rpc_service_role_ok: internalRpcOk,
          internal_rpc_blocked_for_authenticated: internalRpcBlockedForUser,
          anthropic_called: false as const,
        };

        const green =
          preflight.imports.adapter &&
          preflight.imports.step_runner &&
          preflight.imports.claude_client &&
          secretsPresent.supabase_url &&
          secretsPresent.supabase_service_credential &&
          secretsPresent.anthropic_api_key &&
          internalRpcOk;

        console.info(
          "[propose-cv-atoms] preflight",
          JSON.stringify({ green, durationMs: Date.now() - startedAt }),
        );

        return Response.json(
          { ok: true, phase: "3A", green, preflight, duration_ms: Date.now() - startedAt },
          { status: 200 },
        );
      },
    },
  },
});

// Typebruk holder importen av kontrakten levende uten runtime-kost.
export type _ContractProbe = ReadinessReport;
