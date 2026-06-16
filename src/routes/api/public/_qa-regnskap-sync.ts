/**
 * TEMPORARY QA-only endpoint for M5.2.
 * Guarded by SUPABASE_SERVICE_ROLE_KEY header. Removed before M5.2 close.
 *
 * POST /api/public/_qa-regnskap-sync
 *   header: x-qa-token: <service role key>
 *   body:   { mode, orgnrs?, limit?, dryRun?, includePdfYears?, rps?, timeBudgetMs? }
 */

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try { return timingSafeEqual(ab, bb); } catch { return false; }
}

export const Route = createFileRoute("/api/public/_qa-regnskap-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-qa-token") ?? "";
        const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        if (!expected || expected.length < 20 || !safeEq(token, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body0 = await request.clone().text().catch(() => "");
        if (body0.length === 0) {
          // ensure POST-only path requires a JSON body to avoid accidental GET-like probes
        }

        let body: any = {};
        try { body = await request.json(); } catch { /* allow empty */ }

        const { runSync } = await import("@/lib/regnskap-sync.server");
        try {
          const result = await runSync({
            mode: body.mode ?? "orgnrs",
            orgnrs: body.orgnrs,
            limit: body.limit,
            dryRun: body.dryRun,
            includePdfYears: body.includePdfYears,
            rps: body.rps,
            timeBudgetMs: body.timeBudgetMs,
            staleDays: body.staleDays,
            meta: { source: "qa-temp", ...body.meta },
          });
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
