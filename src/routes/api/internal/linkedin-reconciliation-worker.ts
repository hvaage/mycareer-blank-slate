// POST /api/internal/linkedin-reconciliation-worker
//
// Fase 3: intern rute som kjører deterministisk avstemming for én LinkedIn-import.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - worker-hemmelighet i x-worker-secret, konstant-tid-sammenligning
//   - hemmeligheten kontrolleres FØR enhver databasekontakt
//   - saniterte svar: kun tellere, statuser og feilkoder, aldri LinkedIn-innhold
//
// Ruten skriver aldri til produktdata; kun linkedin_reconciliation_*-tabellene.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

type ErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "server_misconfigured"
  | "invalid_request"
  | "import_not_found"
  | "database_error";

function fail(status: number, code: ErrorCode) {
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

const bodySchema = z.object({ import_id: z.string().uuid() });

export const Route = createFileRoute("/api/internal/linkedin-reconciliation-worker")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed"),
      POST: async ({ request }) => {
        const expected = process.env["LINKEDIN_IMPORT_WORKER_SECRET"];
        if (!expected) return fail(500, "server_misconfigured");
        if (!secretMatches(request.headers.get("x-worker-secret"), expected)) {
          return fail(401, "unauthorized");
        }

        let body: z.infer<typeof bodySchema>;
        try {
          body = bodySchema.parse(await request.json());
        } catch {
          return fail(400, "invalid_request");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: importRow, error: importError } = await supabaseAdmin
          .from("linkedin_imports")
          .select("id, user_id, purged_at")
          .eq("id", body.import_id)
          .maybeSingle();
        if (importError) return fail(500, "database_error");
        if (!importRow || importRow.purged_at) return fail(404, "import_not_found");

        const { runReconciliation } = await import(
          "@/lib/linkedin/reconciliation/engine.server"
        );
        const result = await runReconciliation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabaseAdmin as any,
          { userId: importRow.user_id, importId: importRow.id },
        );

        if (!result.ok) return fail(500, "database_error");

        const { runNetworkReconciliationV2 } = await import(
          "@/lib/linkedin/reconciliation/v2/engine.server"
        );
        const networkV2 = await runNetworkReconciliationV2(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabaseAdmin as any,
          { userId: importRow.user_id, importId: importRow.id },
        );

        return Response.json({
          ok: true,
          import_id: importRow.id,
          runs: result.runs.map((r) => ({
            purpose: r.purpose,
            run_id: r.runId,
            status: r.status,
            skip_reason: r.skipReason ?? null,
            proposal_count: r.proposals,
            reused: r.reused ?? false,
          })),
          network_v2: {
            batch_id: networkV2.batchId ?? null,
            status: networkV2.status ?? null,
            counts: networkV2.counts ?? null,
            error: networkV2.error ?? null,
          },
        });
      },
    },
  },
});
