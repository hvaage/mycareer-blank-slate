// GET  /api/cv/atomization-jobs/$jobId  — REN LESING: status, blokker, fremdrift.
// POST /api/cv/atomization-jobs/$jobId  — kun gjenopptakelse: vekker arbeideren.
//
// Modellarbeid og statusendringer skjer utelukkende i den interne
// arbeiderruten (/api/public/cv/atomization-worker) med egen autentisering.
// GET her skriver aldri, og POST utfører aldri modellarbeid — den ber bare
// bakgrunnsarbeideren se på jobben igjen etter en pause eller lukket nettleser.

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
  if (!supabaseUrl || !publishableKey) {
    return { error: fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.") };
  }
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
    .select(
      "id, cv_import_id, status, phase, batch_id, error_code, metrics, attempts, heartbeat_at, lease_expires_at, created_at, updated_at, finished_at",
    )
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

        const job = loaded.job;
        const status = String(job["status"] ?? "queued");
        const heartbeat = job["heartbeat_at"] ? Date.parse(String(job["heartbeat_at"])) : null;
        const staleFor = heartbeat ? Date.now() - heartbeat : null;
        const active = status === "queued" || status === "running";
        // Ren avledning for visning — ingen skriving.
        const stalled = active && (staleFor === null || staleFor > 120_000);

        return Response.json({
          ok: true,
          job,
          blocks: blocks ?? [],
          done: !active,
          job_status: status,
          stalled,
          resumable: stalled,
        });
      },
      // Ingen modellkjøring her: bare et signal til bakgrunnsarbeideren.
      // Med { resume: true } åpnes en avbrutt jobb igjen før signalet sendes.
      POST: async ({ request, params }) => {
        if (!UUID.safeParse(params.jobId).success) {
          return fail(400, "invalid_body", "Ugyldig jobb-id.");
        }
        let payload: { resume?: boolean } = {};
        try {
          payload = ((await request.json()) as { resume?: boolean }) ?? {};
        } catch {
          payload = {};
        }
        const loaded = await loadJob(request, params.jobId);
        if ("error" in loaded) return loaded.error;
        let status = String(loaded.job["status"] ?? "");

        if (payload.resume === true && status !== "queued" && status !== "running") {
          const { data, error } = await loaded.userClient.rpc(
            "cv_atomization_job_resume" as never,
            { p_job_id: params.jobId } as never,
          );
          if (error) return fail(500, "database_error", "Kunne ikke starte analysen igjen.");
          const row = Array.isArray(data) ? (data[0] as Record<string, unknown>) : null;
          status = String(row?.["job_status"] ?? "queued");
        }

        if (status !== "queued" && status !== "running") {
          return Response.json({ ok: true, resumed: false, job_status: status });
        }
        const secret = process.env["CV_ATOMIZATION_WORKER_SECRET"];
        if (!secret) return fail(500, "server_misconfigured", "Analysen er ikke tilgjengelig nå.");
        const { kickAtomizationWorker } = await import(
          "../../../../supabase/functions/_shared/cv-skills/worker-kick.server.ts"
        );
        kickAtomizationWorker({ baseUrl: request.url, secret, jobId: params.jobId });
        return Response.json({ ok: true, resumed: true, job_status: status });
      },
      // Avbryt: setter jobben i en eksplisitt terminal tilstand server-side.
      // Ferdige blokker beholdes; import, fil og kandidater røres ikke.
      DELETE: async ({ request, params }) => {
        if (!UUID.safeParse(params.jobId).success) {
          return fail(400, "invalid_body", "Ugyldig jobb-id.");
        }
        const loaded = await loadJob(request, params.jobId);
        if ("error" in loaded) return loaded.error;
        const { data, error } = await loaded.userClient.rpc(
          "cv_atomization_job_cancel" as never,
          { p_job_id: params.jobId } as never,
        );
        if (error) return fail(500, "database_error", "Kunne ikke avbryte analysen.");
        const row = Array.isArray(data) ? (data[0] as Record<string, unknown>) : null;
        return Response.json({
          ok: true,
          job_status: String(row?.["job_status"] ?? "cancelled"),
        });
      },

    },
  },
});
