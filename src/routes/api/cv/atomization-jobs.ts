// POST /api/cv/atomization-jobs
//
// Starter en asynkron, hierarkisk v2.1-atomisering av én CV-import og
// returnerer jobb-id-en umiddelbart. Selve arbeidet kjøres steg for steg
// gjennom POST /api/cv/atomization-jobs/$jobId, slik at brukeren ser
// fremdrift per ansettelse og rolleblokk.
//
// Sikkerhetskontrakt: POST-only, streng inputvalidering, user_id avvises,
// JWT verifiseres server-side, eierskap håndheves med brukerens egen klient
// før service-credential lastes. Ingen CV-tekst kan sendes inn eller logges.
//
// Skrivekontrakt: jobbtabeller + atom_enrichment_*. career_atoms er urørt.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CV_ATOMIZATION_JOB_LIMITS } from "@/lib/cv-skills-contract";

const UUID = z.string().uuid();

const bodySchema = z
  .object({
    cvImportId: UUID,
    candidateIds: z.array(UUID).min(1).max(CV_ATOMIZATION_JOB_LIMITS.perJob.maxCandidates).optional(),
    regenerate: z.boolean().optional(),
  })
  .strict();

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export const Route = createFileRoute("/api/cv/atomization-jobs")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const correlationId = crypto.randomUUID();
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = null;
        }
        if (raw && typeof raw === "object" && "user_id" in (raw as Record<string, unknown>)) {
          return fail(400, "invalid_body", "user_id kan ikke sendes i forespørselen.");
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return fail(400, "invalid_body", "Ugyldig forespørsel.");
        }

        const { loadJobContext } = await import(
          "../../../../supabase/functions/_shared/cv-skills/job-request-context.server.ts"
        );
        const ctx = await loadJobContext({
          request,
          cvImportId: parsed.data.cvImportId,
          candidateIds: parsed.data.candidateIds,
          requireEligible: true,
        });
        if (!ctx.ok) return fail(ctx.status, ctx.code, ctx.message);

        try {
          const { startAtomizationJob } = await import(
            "../../../../supabase/functions/_shared/cv-skills/atomization-job-runner.ts"
          );
          const outcome = await startAtomizationJob({
            adminClient: ctx.adminClient,
            userId: ctx.userId,
            cvImportId: parsed.data.cvImportId,
            allCandidates: ctx.allCandidates as never,
            selectedRefs: ctx.selectedRefs,
            correlationId,
            regenerate: parsed.data.regenerate === true,
          });

          // Modellarbeidet drives av den interne arbeideren, ikke av brukerens
          // kall. Her sendes bare startsignalet; jobben fortsetter server-side
          // selv om nettleseren lukkes.
          const startedJobId = outcome.body["job_id"];
          const workerSecret = process.env["CV_ATOMIZATION_WORKER_SECRET"];
          if (outcome.status < 400 && typeof startedJobId === "string" && workerSecret) {
            try {
              await fetch(new URL("/api/public/cv/atomization-worker", request.url), {
                method: "POST",
                headers: { "content-type": "application/json", "x-cv-worker-secret": workerSecret },
                body: JSON.stringify({ jobId: startedJobId }),
                signal: AbortSignal.timeout(1_500),
              });
            } catch {
              // Arbeideren kjører videre server-side; reaperen fanger opp resten.
            }
          }

          return Response.json(outcome.body, { status: outcome.status });
        } catch (err) {
          console.error(
            "[atomization-jobs] unhandled",
            JSON.stringify({ correlationId, name: (err as Error)?.name ?? "Error" }),
          );
          return fail(500, "database_error", "Noe gikk galt. Analysen ble ikke startet.");
        }
      },
    },
  },
});
