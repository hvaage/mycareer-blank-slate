// M5.2 regnskap-sync runner — Edge Function.
// verify_jwt=true: caller-JWT kreves. Admin-sjekk via has_role(user.id, 'admin')
// før noe DB-arbeid. SUPABASE_DB_URL brukes kun internt etter admin-sjekk.
// Service role brukes IKKE som auth-token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runSync, type RunSyncInput } from "./runner.ts";
import { runQaSequence } from "./qa.ts";
import { closePool } from "./db.ts";
import { StageError, type Stage, safeMessage } from "./_stage.ts";

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

function errJson(stage: Stage, status: number, message: string, extra: Record<string, unknown> = {}, code: string | null = null, transportStatus = status) {
  const reqId = crypto.randomUUID();
  console.error(`[regnskap-sync] stage=${stage} status=${status} code=${code ?? "-"} reqId=${reqId} :: ${message}`);
  return json({
    ok: false,
    error: safeMessage(message),
    stage,
    code,
    httpStatus: status,
    reqId,
    ...extra,
  }, transportStatus);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errJson("unknown", 405, "method not allowed");

  let stage: Stage = "auth";
  let qaResponseMode = false;
  const fail = (failStage: Stage, status: number, message: string, extra: Record<string, unknown> = {}, code: string | null = null) =>
    errJson(failStage, status, message, extra, code, qaResponseMode ? 200 : status);
  try {
    let body: any = {};
    stage = "parse";
    try { body = await req.json(); } catch { return errJson("parse", 400, "invalid json body"); }
    const op = String(body?.op ?? "run");
    qaResponseMode = op === "qa";

    stage = "auth";
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return fail("auth", 401, "missing bearer token");
    }

    // Env presence (uten å avsløre verdier).
    const dbUrlPresent = !!Deno.env.get("SUPABASE_DB_URL");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return fail("auth", 500, "SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY missing", { env: { SUPABASE_DB_URL: dbUrlPresent } });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return fail("auth", 401, userErr?.message ?? "unauthenticated");
    }
    const userId = userRes.user.id;

    stage = "admin_check";
    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) return fail("admin_check", 500, `role check failed: ${roleErr.message}`, {}, (roleErr as any).code ?? null);
    if (isAdmin !== true) return fail("admin_check", 403, "forbidden: admin required");

    if (!dbUrlPresent) {
      return fail("db_connect", 500, "SUPABASE_DB_URL missing in Edge Function runtime");
    }

    stage = "dispatch";
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
    return fail("dispatch", 400, `unknown op: ${op}`);
  } catch (e) {
    const se = e instanceof StageError ? e : new StageError(stage, e);
    const extra: Record<string, unknown> = {};
    const anyE = e as any;
    if (anyE && typeof anyE.runId === "number") extra.runId = anyE.runId;
    return fail(se.stage, 500, se.message, extra, se.code);
  } finally {
    try { await closePool(); } catch { /* */ }
  }
});
