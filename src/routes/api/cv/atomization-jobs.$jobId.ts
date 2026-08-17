// GET  /api/cv/atomization-jobs/$jobId  — status og fremdrift per blokk
// POST /api/cv/atomization-jobs/$jobId  — kjør neste steg (inntil 3 samtidige kall)
//
// Klienten kaller POST gjentatte ganger til svaret er done. Hvert svar viser
// status per ansettelse og rolleblokk, slik at fremdriften er synlig.
// Sikkerhetskontrakt som resten av CV-API-et: JWT verifiseres server-side,
// eierskap håndheves før service-credential, saniterte feilmeldinger.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const UUID = z.string().uuid();

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

async function loadJob(request: Request, jobId: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) return { error: fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.") };
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
    return { error: fail(401, "unauthorized", "Mangler gyldig pålogging.") };
  }
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { error: fail(401, "unauthorized", "Mangler gyldig pålogging.") };

  const { data: job } = await userClient
    .from("cv_atomization_jobs")
    .select("id, cv_import_id, status, phase, batch_id, error_code, metrics, created_at, finished_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { error: fail(404, "not_found", "Fant ikke analysejobben.") };
  return { userClient, userId, job: job as Record<string, unknown> };
}

export const Route = createFileRoute("/api/cv/atomization-jobs/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!UUID.safeParse(params.jobId).success) {
          return fail(400, "invalid_body", "Ugyldig jobb-id.");
        }
        const loaded = await loadJob(request, params.jobId);
        if ("error" in loaded) return loaded.error;
        const { data: blocks } = await loaded.userClient
          .from("cv_atomization_job_blocks")
          .select("phase, block_key, label, status, error_code, sort_order")
          .eq("job_id", params.jobId)
          .order("sort_order", { ascending: true });
        return Response.json({ ok: true, job: loaded.job, blocks: blocks ?? [] });
      },
      POST: async ({ request, params }) => {
        if (!UUID.safeParse(params.jobId).success) {
          return fail(400, "invalid_body", "Ugyldig jobb-id.");
        }
        const loaded = await loadJob(request, params.jobId);
        if ("error" in loaded) return loaded.error;
        const cvImportId = loaded.job["cv_import_id"] as string;

        const { loadJobContext } = await import(
          "../../../../supabase/functions/_shared/cv-skills/job-request-context.server.ts"
        );
        const ctx = await loadJobContext({ request, cvImportId, requireEligible: false });
        if (!ctx.ok) return fail(ctx.status, ctx.code, ctx.message);

        try {
          const { stepAtomizationJob } = await import(
            "../../../../supabase/functions/_shared/cv-skills/atomization-job-runner.ts"
          );
          const outcome = await stepAtomizationJob({
            adminClient: ctx.adminClient,
            anthropicApiKey: ctx.anthropicApiKey,
            userId: ctx.userId,
            jobId: params.jobId,
            allCandidates: ctx.allCandidates as never,
            selectedRefs: ctx.selectedRefs,
          });
          return Response.json(outcome.body, { status: outcome.status });
        } catch (err) {
          console.error(
            "[atomization-jobs/step] unhandled",
            JSON.stringify({ jobId: params.jobId, name: (err as Error)?.name ?? "Error" }),
          );
          return fail(500, "database_error", "Noe gikk galt under analysen.");
        }
      },
    },
  },
});
