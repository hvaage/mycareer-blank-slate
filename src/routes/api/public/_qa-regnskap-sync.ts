/**
 * TEMPORARY QA-only endpoint for M5.2.
 *
 * Auth: Supabase bearer token + has_role(auth.uid(), 'admin').
 * No service-role token, no Lovable secret.
 *
 * Hard constraints:
 *   - POST only
 *   - mode is forced to 'orgnrs'
 *   - max 5 explicit orgnrs
 *   - no UI link
 *   - file deleted at M5.2 close
 *
 * Invocation (admin signed in; grab bearer from devtools localStorage):
 *   curl -sS -X POST https://<host>/api/public/_qa-regnskap-sync \
 *     -H "Authorization: Bearer <admin access_token>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"orgnrs":["...","..."],"dryRun":true}'
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ORGNR_RE = /^\d{9}$/;

export const Route = createFileRoute("/api/public/_qa-regnskap-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server misconfigured", { status: 500 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) return new Response("Unauthorized", { status: 401 });

        const sb = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (claimsErr || !userId) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data: isAdmin, error: roleErr } = await sb.rpc("has_role", {
          _user_id: userId,
          _role: "admin",
        });
        if (roleErr || isAdmin !== true) {
          return new Response("Forbidden", { status: 403 });
        }

        let body: any = {};
        try { body = await request.json(); } catch { /* allow empty */ }

        const orgnrs: unknown = body?.orgnrs;
        if (!Array.isArray(orgnrs) || orgnrs.length === 0 || orgnrs.length > 5) {
          return Response.json({ error: "orgnrs: array of 1-5 strings required" }, { status: 400 });
        }
        const cleaned: string[] = [];
        for (const o of orgnrs) {
          if (typeof o !== "string" || !ORGNR_RE.test(o)) {
            return Response.json({ error: `invalid orgnr: ${String(o).slice(0, 32)}` }, { status: 400 });
          }
          cleaned.push(o);
        }

        const dryRun = body?.dryRun === true;
        const includePdfYears =
          typeof body?.includePdfYears === "boolean" ? body.includePdfYears : true;
        const rps = typeof body?.rps === "number" ? body.rps : undefined;
        const timeBudgetMs =
          typeof body?.timeBudgetMs === "number" ? body.timeBudgetMs : undefined;

        const { runSync } = await import("@/lib/regnskap-sync.server");
        try {
          const result = await runSync({
            mode: "orgnrs",
            orgnrs: cleaned,
            limit: cleaned.length,
            dryRun,
            includePdfYears,
            rps,
            timeBudgetMs,
            meta: { source: "qa-temp", admin_uid: userId },
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
