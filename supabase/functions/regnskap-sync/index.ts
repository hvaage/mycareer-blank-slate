// M5.3 regnskap-sync — produksjonsrunner.
// Auth: enten caller-JWT (admin via has_role) eller x-cron-secret.
// SUPABASE_DB_URL åpnes ALDRI før auth/secret er validert.
// Ingen op:'qa' her. Ingen MV-refresh i M5.3. Ingen pg_cron schedule aktiveres.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runSync, type RunSyncInput } from "./runner.ts";
import { closePool, withClient, getRecentRuns, getStatusSummary } from "./db.ts";
import { StageError, type Stage, safeMessage, tagStage } from "./_stage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

function json(body: unknown, status = 200): Response {
  const serialized = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  return new Response(serialized, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errJson(stage: Stage, status: number, message: string, extra: Record<string, unknown> = {}, code: string | null = null) {
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
  }, status);
}

// Konstant-tids string-sammenligning. Begge sider eksapanderes til samme lengde
// før loopen, så lengdeforskjeller lekker ikke. Returnerer false hvis lengdene
// avviker, men gjør likevel full loop.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const x = i < ab.length ? ab[i] : 0;
    const y = i < bb.length ? bb[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errJson("unknown", 405, "method not allowed");

  let stage: Stage = "parse";
  try {
    let body: any = {};
    try { body = await req.json(); } catch { return errJson("parse", 400, "invalid json body"); }
    const op = String(body?.op ?? "run");
    if (op !== "run" && op !== "status" && op !== "smoke") {
      return errJson("dispatch", 400, `unknown op: ${op}`);
    }

    // ===== AUTH =====
    stage = "auth";
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return errJson("auth", 500, "SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY missing");
    }

    const cronSecretHeader = req.headers.get("x-cron-secret");
    const cronSecretEnv = Deno.env.get("REGNSKAP_SYNC_CRON_SECRET") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    let authedAs: "admin" | "cron" | null = null;
    let userId: string | null = null;

    if (cronSecretHeader) {
      // x-cron-secret-sti er kun aktiv hvis env-secret er satt.
      if (!cronSecretEnv) return errJson("auth", 401, "cron secret not configured");
      if (!timingSafeEqualStr(cronSecretHeader, cronSecretEnv)) {
        return errJson("auth", 401, "invalid cron secret");
      }
      authedAs = "cron";
    } else if (authHeader.toLowerCase().startsWith("bearer ")) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userRes, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userRes?.user) return errJson("auth", 401, userErr?.message ?? "unauthenticated");
      userId = userRes.user.id;

      stage = "admin_check";
      const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (roleErr) return errJson("admin_check", 500, `role check failed: ${roleErr.message}`, {}, (roleErr as any).code ?? null);
      if (isAdmin !== true) return errJson("admin_check", 403, "forbidden: admin required");
      authedAs = "admin";
    } else {
      return errJson("auth", 401, "missing authorization or x-cron-secret");
    }

    // ===== DB =====
    if (!Deno.env.get("SUPABASE_DB_URL")) {
      return errJson("db_connect", 500, "SUPABASE_DB_URL missing in Edge Function runtime");
    }

    stage = "dispatch";
    if (op === "status") {
      const result = await tagStage("db_connect", () => withClient(async (c) => {
        const [recentRuns, statusSummary] = await Promise.all([
          getRecentRuns(c, 5),
          getStatusSummary(c, 180),
        ]);
        return { ok: true, authedAs, recentRuns, statusSummary, now: new Date().toISOString() };
      }));
      return json(result);
    }

    if (op === "smoke") {
      const input: RunSyncInput = {
        mode: "due",
        limit: 1,
        rps: 1,
        timeBudgetMs: 20_000,
        dryRun: false,
        includePdfYears: true,
        meta: { triggeredBy: authedAs, admin_uid: userId ?? undefined, kind: "smoke" },
      };
      const result = await runSync(input);
      return json({ ok: true, authedAs, kind: "smoke", result });
    }

    // op === "run"
    const mode = String(body?.mode ?? "due") as RunSyncInput["mode"];
    const input: RunSyncInput = {
      mode,
      orgnrs: Array.isArray(body?.orgnrs) ? body.orgnrs.slice(0, 100).map((s: unknown) => String(s)) : undefined,
      limit: typeof body?.limit === "number" ? body.limit : 20,
      dryRun: body?.dryRun === true,
      timeBudgetMs: typeof body?.timeBudgetMs === "number" ? body.timeBudgetMs : 50_000,
      rps: typeof body?.rps === "number" ? body.rps : 1,
      staleDays: typeof body?.staleDays === "number" ? body.staleDays : undefined,
      includePdfYears: body?.includePdfYears === false ? false : true,
      meta: { ...(body?.meta ?? {}), triggeredBy: authedAs, admin_uid: userId ?? undefined },
    };
    const result = await runSync(input);
    return json({ ok: true, authedAs, kind: "run", result });
  } catch (e) {
    const se = e instanceof StageError ? e : new StageError(stage, e);
    const extra: Record<string, unknown> = {};
    const anyE = e as any;
    if (anyE && typeof anyE.runId === "number") extra.runId = anyE.runId;
    return errJson(se.stage, 500, se.message, extra, se.code);
  } finally {
    try { await closePool(); } catch { /* */ }
  }
});
