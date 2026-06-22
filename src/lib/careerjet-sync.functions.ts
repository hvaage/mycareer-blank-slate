import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type CareerjetRunRow = {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  error_summary: string | null;
  rows_fetched: number;
  rows_upserted: number;
  rows_expired: number;
  rows_reactivated: number;
  rows_failed: number;
  terms_covered: number;
  api_errors_count: number;
  duration_ms: number | null;
  cursor_term: string | null;
  cursor_page: number | null;
  meta: any;
  // S6: replay-runs stay visible in the run history but must NOT be treated
  // as "latest Careerjet sync" by the admin status card.
  is_replay: boolean;
  source_run_id: string | null;
};

export type CareerjetSyncStatus = {
  now: string;
  runs: CareerjetRunRow[];
  /** S6: most recent run where meta->>'mode' IS DISTINCT FROM 'replay'. */
  latest_non_replay_run: CareerjetRunRow | null;
  cron: { jobname: string; schedule: string | null; active: boolean | null } | null;
  vault: { has_sync_careerjet_secret: boolean };
  duplicates: {
    source_postings_careerjet: number;
    distinct_external_ids: number;
    duplicate_external_ids: { external_id: string; count: number }[];
  };
  quality: {
    careerjet_source_postings: number;
    missing_raw_payload: number;
    careerjet_canonical_total: number;
    careerjet_canonical_with_grace: number;
    user_opportunities_careerjet: number;
    inactive_source_postings: number;
  };
  prefix_counts: { prefix: string; count: number }[];
  term_coverage: {
    total_active: number;
    run_last_24h: number;
    run_last_7d: number;
    oldest_last_run_at: string | null;
  } | null;
  last_seen: {
    min: string | null;
    max: string | null;
    median: string | null;
  } | null;
};

export const getCareerjetSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CareerjetSyncStatus> => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const { data: runs, error: runsErr } = await supabaseAdmin
      .from("careerjet_sync_runs")
      .select(
        "id, started_at, finished_at, status, error_summary, rows_fetched, rows_upserted, rows_expired, rows_reactivated, rows_failed, terms_covered, api_errors, cursor_term, cursor_page, meta"
      )
      .order("started_at", { ascending: false })
      .limit(50);
    if (runsErr) throw new Error(`runs: ${runsErr.message}`);

    const enriched: CareerjetRunRow[] = (runs ?? []).map((r: any) => {
      const start = r.started_at ? new Date(r.started_at).getTime() : null;
      const end = r.finished_at ? new Date(r.finished_at).getTime() : null;
      const apiErrors = Array.isArray(r.api_errors) ? r.api_errors : [];
      const metaMode = typeof r.meta?.mode === "string" ? r.meta.mode : null;
      const sourceRunId = typeof r.meta?.source_run_id === "string" ? r.meta.source_run_id : null;
      return {
        id: r.id,
        started_at: r.started_at,
        finished_at: r.finished_at,
        status: r.status,
        error_summary: r.error_summary,
        rows_fetched: r.rows_fetched ?? 0,
        rows_upserted: r.rows_upserted ?? 0,
        rows_expired: r.rows_expired ?? 0,
        rows_reactivated: r.rows_reactivated ?? 0,
        rows_failed: r.rows_failed ?? 0,
        terms_covered: r.terms_covered ?? 0,
        api_errors_count: apiErrors.length,
        duration_ms: start && end ? end - start : null,
        cursor_term: r.cursor_term ?? null,
        cursor_page: r.cursor_page ?? null,
        meta: r.meta ?? {},
        is_replay: metaMode === "replay",
        source_run_id: sourceRunId,
      };
    });

    // S6: "latest Careerjet sync" must exclude replay-runs.
    const latest_non_replay_run = enriched.find((r) => !r.is_replay) ?? null;

    let cron: CareerjetSyncStatus["cron"] = null;
    try {
      const { data: cronRows } = await supabaseAdmin.rpc("get_careerjet_sync_cron_info");
      if (Array.isArray(cronRows) && cronRows.length) {
        const c = cronRows[0] as any;
        cron = { jobname: c.jobname, schedule: c.schedule, active: c.active };
      }
    } catch { /* ignore */ }

    let vault = { has_sync_careerjet_secret: false };
    try {
      const { data: vaultRes } = await supabaseAdmin.rpc("careerjet_sync_vault_has_secret");
      vault.has_sync_careerjet_secret = Boolean(vaultRes);
    } catch { /* ignore */ }

    const { data: dupRows } = await supabaseAdmin.rpc("careerjet_sync_duplicate_external_ids");
    const duplicate_external_ids = Array.isArray(dupRows)
      ? (dupRows as any[]).map((r) => ({ external_id: r.external_id, count: Number(r.count ?? 0) }))
      : [];

    const { count: spCount } = await supabaseAdmin
      .from("source_postings")
      .select("id", { count: "exact", head: true })
      .eq("source", "careerjet");

    const { data: distinctRow } = await supabaseAdmin.rpc("careerjet_sync_distinct_external_count");
    const distinct = Number((distinctRow as any) ?? 0);

    const { data: missingRow } = await supabaseAdmin.rpc("careerjet_sync_count_missing_raw_payload");
    const missing = Number((missingRow as any) ?? 0);

    const { count: canonTotal } = await supabaseAdmin
      .from("canonical_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("primary_source", "careerjet");

    const { count: canonWithGrace } = await supabaseAdmin
      .from("canonical_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("primary_source", "careerjet")
      .not("live_until", "is", null);

    const { count: userOpps } = await supabaseAdmin
      .from("user_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("card_source", "careerjet");

    const { count: inactive } = await supabaseAdmin
      .from("source_postings")
      .select("id", { count: "exact", head: true })
      .eq("source", "careerjet")
      .in("posting_status", ["expired", "removed"]);

    const { data: prefRows } = await supabaseAdmin.rpc("careerjet_sync_external_id_prefix_counts");
    const prefix_counts = Array.isArray(prefRows)
      ? (prefRows as any[]).map((r) => ({ prefix: r.prefix, count: Number(r.count ?? 0) }))
      : [];

    let term_coverage: CareerjetSyncStatus["term_coverage"] = null;
    try {
      const { data: tc } = await supabaseAdmin.rpc("careerjet_sync_term_coverage");
      if (Array.isArray(tc) && tc.length) {
        const t = tc[0] as any;
        term_coverage = {
          total_active: Number(t.total_active ?? 0),
          run_last_24h: Number(t.run_last_24h ?? 0),
          run_last_7d: Number(t.run_last_7d ?? 0),
          oldest_last_run_at: t.oldest_last_run_at ?? null,
        };
      }
    } catch { /* ignore */ }

    let last_seen: CareerjetSyncStatus["last_seen"] = null;
    try {
      const { data: ls } = await supabaseAdmin.rpc("careerjet_sync_last_seen_stats");
      if (Array.isArray(ls) && ls.length) {
        const l = ls[0] as any;
        last_seen = {
          min: l.min_last_seen ?? null,
          max: l.max_last_seen ?? null,
          median: l.median_last_seen ?? null,
        };
      }
    } catch { /* ignore */ }

    return {
      now: new Date().toISOString(),
      runs: enriched,
      latest_non_replay_run,
      cron,
      vault,
      duplicates: {
        source_postings_careerjet: spCount ?? 0,
        distinct_external_ids: distinct,
        duplicate_external_ids,
      },
      quality: {
        careerjet_source_postings: spCount ?? 0,
        missing_raw_payload: missing,
        careerjet_canonical_total: canonTotal ?? 0,
        careerjet_canonical_with_grace: canonWithGrace ?? 0,
        user_opportunities_careerjet: userOpps ?? 0,
        inactive_source_postings: inactive ?? 0,
      },
      prefix_counts,
      term_coverage,
      last_seen,
    };
  });

export type TriggerCareerjetSyncResult = {
  http_status: number;
  ok: boolean;
  body: string;
  duration_ms: number;
};

export const triggerCareerjetSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TriggerCareerjetSyncResult> => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const url = process.env.SUPABASE_URL;
    const secret = process.env.SYNC_CAREERJET_SECRET;
    if (!url) throw new Error("SUPABASE_URL missing");
    if (!secret) throw new Error("SYNC_CAREERJET_SECRET missing");

    const started = Date.now();
    const resp = await fetch(`${url}/functions/v1/sync-careerjet-opportunities`, {
      method: "POST",
      headers: {
        "x-sync-careerjet-secret": secret,
        "Content-Type": "application/json",
      },
    });
    const duration_ms = Date.now() - started;
    const body = await resp.text();
    return { http_status: resp.status, ok: resp.ok, body, duration_ms };
  });
