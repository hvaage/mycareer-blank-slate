// M5.2 regnskap-sync runner — Edge Function.
// verify_jwt=true: caller-JWT kreves. Admin-sjekk via has_role(user.id, 'admin')
// før noe DB-arbeid. SUPABASE_DB_URL brukes kun internt etter admin-sjekk.
// Service role brukes IKKE som auth-token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runSync, type RunSyncInput } from "./runner.ts";
import { runQaSequence } from "./qa.ts";
import { closePool } from "./db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const QA_ORGNRS_DEFAULT = ["923609016","976239997","984851006","929877950","984661185"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 1) caller-JWT (verify_jwt=true håndterer verifisering; vi henter user med samme token)
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "missing bearer token" }, 401);
  }

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "unauthenticated" }, 401);
    const userId = userRes.user.id;

    // 2) Admin-sjekk via has_role som autentisert bruker
    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) return json({ error: `role check failed: ${roleErr.message}` }, 500);
    if (isAdmin !== true) return json({ error: "forbidden: admin required" }, 403);

    // 3) Parse body
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid json body" }, 400); }

    const op = String(body?.op ?? "run");

    if (op === "qa") {
      const orgnrs: string[] = Array.isArray(body?.orgnrs) && body.orgnrs.length > 0
        ? body.orgnrs.slice(0, 5).map((s: unknown) => String(s))
        : QA_ORGNRS_DEFAULT;
      const result = await runQaSequence(orgnrs, userId);
      return json(result);
    }

    if (op === "run") {
      const mode = String(body?.mode ?? "due") as RunSyncInput["mode"];
      const input: RunSyncInput = {
        mode,
        orgnrs: Array.isArray(body?.orgnrs) ? body.orgnrs.slice(0, 100).map((s: unknown) => String(s)) : undefined,
        limit: typeof body?.limit === "number" ? body.limit : undefined,
        dryRun: body?.dryRun === true,
        timeBudgetMs: typeof body?.timeBudgetMs === "number" ? body.timeBudgetMs : undefined,
        rps: typeof body?.rps === "number" ? body.rps : undefined,
        staleDays: typeof body?.staleDays === "number" ? body.staleDays : undefined,
        includePdfYears: body?.includePdfYears === false ? false : true,
        meta: { ...(body?.meta ?? {}), admin_uid: userId },
      };
      const result = await runSync(input);
      return json(result);
    }

    return json({ error: `unknown op: ${op}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  } finally {
    try { await closePool(); } catch { /* */ }
  }
});
