// Fase 5D — serverhandlinger for KI-aktivitetsforslag.
//
// Klienten sender aldri user_id: brukerens id kommer fra sesjonen.
// All skriving går gjennom SECURITY DEFINER-RPC-er som verken anon
// eller authenticated kan kalle.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL_PROFILE = "network_activity_suggestions_v1";
const PROMPT_VERSION = "1.0.0+out1";

const startSchema = z.object({
  scope: z.enum(["overview", "company", "contact", "opportunity"]),
  scopeObjectId: z.string().uuid().nullable().optional(),
  regenerate: z.boolean().optional(),
  /** Fokus styrer kildevekting og tillatte aktivitetstyper. Standard: nettverk. */
  focus: z.enum(["nettverk", "oppfolging", "soknad", "alle"]).optional(),
});

export const startActivitySuggestionRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const scopeObjectId = data.scope === "overview" ? null : (data.scopeObjectId ?? null);
    if (data.scope !== "overview" && !scopeObjectId) {
      return { ok: false as const, errorCode: "invalid_scope", runId: null, reused: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
      from: (t: string) => any;
    };

    const { buildSuggestionContext } = await import("@/lib/network-suggestions/context.server");
    const built = await buildSuggestionContext({
      adminClient: admin,
      userId: context.userId,
      scope: data.scope,
      scopeObjectId,
    });

    const { data: result, error } = await admin.rpc("network_enqueue_suggestion_run", {
      p_user_id: context.userId,
      p_scope: data.scope,
      p_scope_object_id: scopeObjectId,
      p_signature_base: built.signatureBase,
      p_regenerate: data.regenerate === true,
      p_model_profile: MODEL_PROFILE,
      p_prompt_version: PROMPT_VERSION,
    });

    const payload = (result ?? null) as {
      ok?: boolean;
      error_code?: string;
      run_id?: string;
      reused?: boolean;
      status?: string;
    } | null;

    if (error || !payload?.ok) {
      return {
        ok: false as const,
        errorCode: payload?.error_code ?? "enqueue_failed",
        runId: null,
        reused: false,
      };
    }

    // Start arbeideren uten å blokkere svaret. Feiler kicket, plukkes
    // kjøringen opp av det planlagte worker-kallet.
    if (!payload.reused || payload.status === "queued") {
      const secret = process.env["NETWORK_SUGGESTIONS_WORKER_SECRET"];
      const { getRequest } = await import("@tanstack/react-start/server");
      const origin = (() => {
        try {
          return new URL(getRequest().url).origin;
        } catch {
          return null;
        }
      })();
      if (secret && origin) {
        void fetch(new URL("/api/public/jobs/network-suggestions", origin), {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": secret },
          body: "{}",
        })
          .then((res) => res.text().catch(() => ""))
          .catch(() => undefined);
      }
    }


    return {
      ok: true as const,
      errorCode: null,
      runId: payload.run_id ?? null,
      reused: payload.reused === true,
      status: payload.status ?? "queued",
    };
  });

const decideSchema = z.object({
  suggestionId: z.string().uuid(),
  decision: z.enum(["accepted", "dismissed"]),
  activityId: z.string().uuid().nullable().optional(),
});

export const decideActivitySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => decideSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_decide_activity_suggestion" as never,
      {
        p_user_id: context.userId,
        p_suggestion_id: data.suggestionId,
        p_decision: data.decision,
        p_activity_id: data.activityId ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false as const, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true as const, errorCode: null };
  });
