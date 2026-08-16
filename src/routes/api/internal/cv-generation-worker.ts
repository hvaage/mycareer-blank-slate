// POST /api/internal/cv-generation-worker
//
// Fase 4A: worker-preflight for CV-generering. Ruten kjører maksimalt ett
// jobbsteg per forespørsel og eier ingen forretningslogikk for generering ennå.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - egen worker-hemmelighet i x-worker-secret, konstant-tid-sammenligning
//   - bruker-JWT godtas aldri som erstatning for hemmeligheten
//   - hemmeligheten kontrolleres før enhver databasekontakt
//   - saniterte svar: ingen jobbinnhold, CV-tekst, promptinnhold eller nøkler
//
// Kjørekontrakt:
//   - claim committes av RPC-en før arbeidet starter
//   - hjerteslag sendes jevnlig mens steget kjører
//   - steget avsluttes alltid gjennom complete/requeue/fail
//   - forespørselen holdes åpen til steget er ferdig (ingen waitUntil)

import { createFileRoute } from "@tanstack/react-router";

type WorkerErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "server_misconfigured"
  | "database_error";

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Preflight-jobben sover i små steg slik at hjerteslag rekker å gå ut. */
const PREFLIGHT_MAX_SLEEP_MS = 180_000;
/** Preflight kjøres som en syntetisk review_proposals-jobb merket preflight. */
const PREFLIGHT_JOB_KIND = "review_proposals";

function fail(status: number, code: WorkerErrorCode) {
  return Response.json({ ok: false, error: { code } }, { status });
}

/** Konstant tid over hele lengden; lekker ikke lengde via tidsbruk. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const Route = createFileRoute("/api/internal/cv-generation-worker")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed"),
      POST: async ({ request }) => {
        // --- 1. hemmelighet før alt annet -------------------------------
        const expected = process.env["CV_GENERATION_WORKER_SECRET"];
        if (!expected) return fail(500, "server_misconfigured");
        if (!secretMatches(request.headers.get("x-worker-secret"), expected)) {
          // Bruker-JWT gir ingen tilgang her.
          return fail(401, "unauthorized");
        }

        const supabaseUrl = process.env["SUPABASE_URL"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!supabaseUrl || !serviceKey) return fail(500, "server_misconfigured");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const workerId = `worker_${crypto.randomUUID()}`;

        // --- 2. claim (committes av RPC-en) -----------------------------
        const { data: claim, error: claimError } = await supabaseAdmin.rpc(
          "internal_ai_claim_job_step",
          { p_worker_id: workerId, p_max_concurrency: 4 },
        );
        if (claimError) {
          console.error("[cv-generation-worker] claim failed", claimError.code ?? "unknown");
          return fail(500, "database_error");
        }
        const claimed = (claim ?? {}) as {
          claimed?: boolean;
          reason?: string;
          job_id?: string;
          job_kind?: string;
          input_payload?: Record<string, unknown> | null;
          attempt_count?: number;
          max_attempts?: number;
        };
        if (!claimed.claimed || !claimed.job_id) {
          return Response.json({
            ok: true,
            worked: false,
            reason: claimed.reason ?? "no_work",
          });
        }

        const jobId = claimed.job_id;
        let leaseLost = false;
        const heartbeat = setInterval(() => {
          void supabaseAdmin
            .rpc("internal_ai_job_heartbeat", { p_job_id: jobId, p_worker_id: workerId })
            .then((res: { data: unknown }) => {
              const d = res.data as { ok?: boolean } | null;
              if (d && d.ok === false) leaseLost = true;
            });
        }, HEARTBEAT_INTERVAL_MS);

        // --- 3. ett steg ------------------------------------------------
        try {
          const payload = (claimed.input_payload ?? {}) as {
            preflight?: unknown;
            sleep_ms?: unknown;
          };
          if (claimed.job_kind === PREFLIGHT_JOB_KIND && payload.preflight === true) {
            const requested = typeof payload.sleep_ms === "number" ? payload.sleep_ms : 0;
            const total = Math.min(Math.max(requested, 0), PREFLIGHT_MAX_SLEEP_MS);
            const startedAt = Date.now();
            while (Date.now() - startedAt < total && !leaseLost) {
              await sleep(Math.min(1_000, total - (Date.now() - startedAt)));
            }
            if (leaseLost) {
              await supabaseAdmin.rpc("internal_ai_requeue_job", {
                p_job_id: jobId,
                p_worker_id: workerId,
                p_error_code: "lease_lost",
                p_error: "lease_lost",
              });
              return Response.json({ ok: true, worked: true, outcome: "requeued" });
            }
            const { error } = await supabaseAdmin.rpc("internal_ai_complete_job", {
              p_job_id: jobId,
              p_worker_id: workerId,
              p_status: "succeeded",
              p_result: { preflight: true, duration_ms: Date.now() - startedAt },
              p_model_run_id: undefined as unknown as string,
            });
            if (error) {
              console.error("[cv-generation-worker] complete failed", error.code ?? "unknown");
              return fail(500, "database_error");
            }
            return Response.json({ ok: true, worked: true, outcome: "succeeded" });
          }

          if (claimed.job_kind === "generate_general_cv") {
            const modelKey = process.env["ANTHROPIC" + "_API_KEY"];
            if (!modelKey) {
              await supabaseAdmin.rpc("internal_ai_fail_job", {
                p_job_id: jobId,
                p_worker_id: workerId,
                p_error_code: "server_misconfigured",
                p_error: "server_misconfigured",
              });
              return fail(500, "server_misconfigured");
            }

            const { data: jobRow, error: jobError } = await supabaseAdmin
              .from("cv_generation_jobs")
              .select("user_id, current_step, step_state, rewrite_count, document_id, input_payload")
              .eq("id", jobId)
              .maybeSingle();
            if (jobError || !jobRow || !jobRow.document_id) {
              await supabaseAdmin.rpc("internal_ai_fail_job", {
                p_job_id: jobId,
                p_worker_id: workerId,
                p_error_code: "database_error",
                p_error: "job_state_missing",
              });
              return fail(500, "database_error");
            }

            const { runGenerationStep } = await import(
              "../../../../supabase/functions/_shared/cv-skills/generation/runner.ts"
            );
            const outcome = await runGenerationStep({
              adminClient: supabaseAdmin,
              anthropicApiKey: modelKey,
              jobId,
              workerId,
              userId: jobRow.user_id as string,
              step: (jobRow.current_step ?? "prepare_snapshot") as never,
              documentId: jobRow.document_id as string,
              inputPayload: (jobRow.input_payload ?? {}) as Record<string, unknown>,
              stepState: (jobRow.step_state ?? {}) as Record<string, unknown>,
              rewriteCount: (jobRow.rewrite_count ?? 0) as number,
              correlationId: crypto.randomUUID(),
            });

            // Retrybare utfall committer ikke steget; jobben legges tilbake i kø
            // på samme steg, uten ny dokumentversjon.
            if (outcome.terminal === null && outcome.nextStep === null) {
              await supabaseAdmin.rpc("internal_ai_requeue_job", {
                p_job_id: jobId,
                p_worker_id: workerId,
                p_error_code: outcome.errorCode ?? "provider_error",
                p_error: outcome.errorCode ?? "provider_error",
              });
              return Response.json({
                ok: true,
                worked: true,
                outcome: "requeued",
                step: outcome.step,
                error_code: outcome.errorCode,
                duration_ms: outcome.durationMs,
              });
            }

            return Response.json({
              ok: true,
              worked: true,
              outcome: outcome.outcome,
              step: outcome.step,
              next_step: outcome.nextStep,
              terminal: outcome.terminal,
              error_code: outcome.errorCode,
              duration_ms: outcome.durationMs,
            });
          }

          // Ukjent jobbtype: terminer kontrollert.
          await supabaseAdmin.rpc("internal_ai_fail_job", {
            p_job_id: jobId,
            p_worker_id: workerId,
            p_error_code: "not_implemented",
            p_error: "job kind not implemented",
          });
          return Response.json({ ok: true, worked: true, outcome: "failed" });
        } catch {
          await supabaseAdmin.rpc("internal_ai_fail_job", {
            p_job_id: jobId,
            p_worker_id: workerId,
            p_error_code: "worker_error",
            p_error: "worker_error",
          });
          return fail(500, "database_error");
        } finally {
          clearInterval(heartbeat);
        }
      },
    },
  },
});
