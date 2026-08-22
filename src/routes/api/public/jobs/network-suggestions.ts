// POST /api/public/jobs/network-suggestions
//
// Bakgrunnsarbeider for KI-aktivitetsforslag i Nettverksarbeid.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - egen worker-hemmelighet i x-worker-secret, konstant-tid-sammenligning
//   - bruker-JWT gir ingen tilgang
//   - saniterte svar: ingen forslagsinnhold, kontaktdata eller nøkler
//
// Kjørekontrakt:
//   - reaper først: kjøringer med utløpt lås settes i kø igjen eller feiles
//   - én kjøring per forespørsel, avsluttes alltid via finish-RPC-en
//   - hjerteslag mens modellkallet pågår
//   - brukeren kan lukke siden; kjøringen fortsetter her

import { createFileRoute } from "@tanstack/react-router";

const LEASE_SECONDS = 300;
const HEARTBEAT_INTERVAL_MS = 30_000;

function fail(status: number, code: string) {
  return Response.json({ ok: false, error: { code } }, { status });
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/jobs/network-suggestions")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed"),
      POST: async ({ request }) => {
        const expected = process.env["NETWORK_SUGGESTIONS_WORKER_SECRET"];
        if (!expected) return fail(500, "server_misconfigured");
        if (!secretMatches(request.headers.get("x-worker-secret"), expected)) {
          return fail(401, "unauthorized");
        }
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey) return fail(500, "server_misconfigured");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as {
          rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
          from: (t: string) => any;
        };

        const { data: reaped } = await admin.rpc("network_reap_stale_suggestion_runs");

        const leaseOwner = `worker:${crypto.randomUUID()}`;
        const { data: claimed, error: claimError } = await admin.rpc("network_claim_suggestion_run", {
          p_lease_owner: leaseOwner,
          p_lease_seconds: LEASE_SECONDS,
        });
        if (claimError) return fail(500, "database_error");

        const run = (claimed as any)?.run ?? null;
        if (!run) {
          return Response.json({ ok: true, claimed: false, reaped: reaped ?? null });
        }

        const heartbeat = setInterval(() => {
          void admin.rpc("network_heartbeat_suggestion_run", {
            p_run_id: run.id,
            p_lease_owner: leaseOwner,
            p_lease_seconds: LEASE_SECONDS,
          });
        }, HEARTBEAT_INTERVAL_MS);

        try {
          const { runSuggestionJob } = await import("@/lib/network-suggestions/runner.server");
          const outcome = await runSuggestionJob({
            adminClient: admin,
            apiKey,
            userId: run.user_id,
            scope: run.scope,
            scopeObjectId: run.scope_object_id ?? null,
            correlationId: run.correlation_id,
          });

          await admin.rpc("network_finish_suggestion_run", {
            p_run_id: run.id,
            p_lease_owner: leaseOwner,
            p_status: outcome.status,
            p_error_code: outcome.status === "succeeded" ? null : outcome.errorCode,
            p_model_run_id: outcome.modelRunId,
            p_model_name: outcome.modelName,
            p_items: outcome.status === "succeeded" ? outcome.items : [],
          });

          return Response.json({
            ok: true,
            claimed: true,
            status: outcome.status,
            count: outcome.status === "succeeded" ? outcome.items.length : 0,
          });
        } catch (err) {
          console.error(
            "[network-suggestions] unhandled",
            JSON.stringify({ runId: run.id, name: (err as Error)?.name ?? "Error" }),
          );
          await admin.rpc("network_finish_suggestion_run", {
            p_run_id: run.id,
            p_lease_owner: leaseOwner,
            p_status: "retry",
            p_error_code: "worker_exception",
            p_model_run_id: null,
            p_model_name: null,
            p_items: [],
          });
          return fail(500, "worker_error");
        } finally {
          clearInterval(heartbeat);
        }
      },
    },
  },
});
