// Engangsrute: speiler worker-hemmeligheten fra runtime-miljøet inn i vault,
// slik at pg_cron kan sende riktig header uten at verdien håndteres manuelt.
// Autentiseres med selve worker-hemmeligheten. Slettes etter bruk.
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/ops/sync-worker-secret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["NETWORK_SUGGESTIONS_WORKER_SECRET"];
        if (!expected) return Response.json({ ok: false, error: "server_misconfigured" }, { status: 500 });
        const given = request.headers.get("x-worker-secret") ?? "";
        if (!given || !timingSafeEqualStr(given, expected)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await (supabaseAdmin as any).rpc("network_store_worker_secret", {
          p_secret: expected,
        });
        if (error) return Response.json({ ok: false, error: "database_error" }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
