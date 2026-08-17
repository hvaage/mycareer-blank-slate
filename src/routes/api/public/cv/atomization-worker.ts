// POST /api/public/cv/atomization-worker
//
// Kontrollert bakgrunnsarbeider for CV-atomisering. Dette er det eneste stedet
// modellarbeid kjøres og jobbstatus endres. Ruten har egen autentisering med en
// delt hemmelighet — den er ikke tilgjengelig for innloggede brukere, og
// brukerens egne kall (GET/poll) skriver aldri.
//
// Kjøringen tar lås på jobben, kjører steg innenfor et tidsbudsjett, fornyer
// låsen underveis og kjeder seg selv videre hvis mer gjenstår. Lukkes eller
// oppdateres nettleseren, fortsetter jobben her; stopper arbeideren, henter
// reaperen jobben tilbake i kø ved neste kall.

import { createFileRoute } from "@tanstack/react-router";

const TIME_BUDGET_MS = 45_000;
const MAX_STEPS = 40;
const LEASE_SECONDS = 180;

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Kjeder arbeideren videre uten å blokkere svaret. */
async function retrigger(request: Request, secret: string, jobId: string) {
  const { kickAtomizationWorker } = await import(
    "../../../../../supabase/functions/_shared/cv-skills/worker-kick.server.ts"
  );
  kickAtomizationWorker({ baseUrl: request.url, secret, jobId });
}

export const Route = createFileRoute("/api/public/cv/atomization-worker")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const secret = process.env["CV_ATOMIZATION_WORKER_SECRET"];
        if (!secret) return fail(500, "server_misconfigured", "Arbeideren er ikke konfigurert.");
        const provided = request.headers.get("x-cv-worker-secret") ?? "";
        if (!provided || !constantTimeEqual(provided, secret)) {
          return fail(401, "unauthorized", "Ugyldig arbeidernøkkel.");
        }

        let body: { jobId?: string } = {};
        try {
          body = ((await request.json()) as { jobId?: string }) ?? {};
        } catch {
          body = {};
        }
        const jobId = typeof body.jobId === "string" ? body.jobId : null;

        const { claimWorkerJobContext, reapStaleAtomizationJobs } = await import(
          "../../../../../supabase/functions/_shared/cv-skills/job-request-context.server.ts"
        );

        const reaped = await reapStaleAtomizationJobs();

        const leaseOwner = `worker:${crypto.randomUUID()}`;
        const ctx = await claimWorkerJobContext({ leaseOwner, jobId, leaseSeconds: LEASE_SECONDS });
        if (!ctx.ok) {
          if (ctx.status === 204) {
            return Response.json({ ok: true, claimed: false, reaped });
          }
          return fail(ctx.status, ctx.code, ctx.message);
        }

        const { stepAtomizationJob } = await import(
          "../../../../../supabase/functions/_shared/cv-skills/atomization-job-runner.ts"
        );

        const startedAt = Date.now();
        let steps = 0;
        let done = false;
        let jobStatus: string | null = null;

        try {
          while (steps < MAX_STEPS && Date.now() - startedAt < TIME_BUDGET_MS) {
            const outcome = await stepAtomizationJob({
              adminClient: ctx.adminClient,
              anthropicApiKey: ctx.anthropicApiKey,
              userId: ctx.userId,
              jobId: ctx.jobId,
              allCandidates: ctx.allCandidates as never,
              selectedRefs: ctx.selectedRefs,
            });
            steps += 1;
            if (outcome.status >= 400) {
              jobStatus = "failed";
              break;
            }
            if (outcome.body["done"] === true) {
              done = true;
              jobStatus = (outcome.body["job_status"] as string) ?? "complete";
              break;
            }
            await ctx.adminClient.rpc("internal_cv_atomization_heartbeat", {
              p_job_id: ctx.jobId,
              p_owner: leaseOwner,
              p_lease_seconds: LEASE_SECONDS,
            });
          }
        } catch (err) {
          console.error(
            "[cv-worker] unhandled",
            JSON.stringify({ jobId: ctx.jobId, name: (err as Error)?.name ?? "Error" }),
          );
        } finally {
          await ctx.adminClient.rpc("internal_cv_atomization_release", {
            p_job_id: ctx.jobId,
            p_owner: leaseOwner,
          });
        }

        if (!done) await retrigger(request, secret, ctx.jobId);

        return Response.json({
          ok: true,
          claimed: true,
          job_id: ctx.jobId,
          steps,
          done,
          job_status: jobStatus,
          reaped,
        });
      },
    },
  },
});
