// GET /api/cv/generations/:jobId
//
// Sanitert status og utkast for én generering. Kun eieren får svar.
// Bruker-ID hentes fra verifisert JWT; jobId alene gir ingen tilgang.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type ErrorCode =
  | "method_not_allowed"
  | "invalid_body"
  | "unauthorized"
  | "not_found"
  | "server_misconfigured"
  | "database_error";

function fail(status: number, code: ErrorCode, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export const Route = createFileRoute("/api/cv/generations/$jobId")({
  server: {
    handlers: {
      POST: async () => fail(405, "method_not_allowed", "Bruk GET."),
      GET: async ({ request, params }) => {
        const jobId = z.string().uuid().safeParse(params.jobId);
        if (!jobId.success) return fail(400, "invalid_body", "Ugyldig jobb-id.");

        const supabaseUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!supabaseUrl || !publishableKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }
        const userClient = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: authHeader } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await userClient.auth.getUser();
        const userId = userData?.user?.id;
        if (userError || !userId) return fail(401, "unauthorized", "Mangler gyldig pålogging.");

        const { data, error } = await userClient.rpc("internal_ai_get_cv_generation", {
          p_user_id: userId,
          p_job_id: jobId.data,
        });
        if (error) return fail(500, "database_error", "Kunne ikke hente genereringen.");
        const res = (data ?? {}) as { ok?: boolean; generation?: unknown };
        if (res.ok !== true) return fail(404, "not_found", "Fant ikke denne genereringen.");

        return Response.json({ ok: true, generation: res.generation });
      },
    },
  },
});
