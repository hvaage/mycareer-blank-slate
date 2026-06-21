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

export type NavSyncRunRow = {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
  mode: string;
  fetched: number | null;
  upserted: number | null;
  expired: number | null;
  reactivated: number | null;
  matched_user_opps: number | null;
  scored: number | null;
  noop: number | null;
  stale: number | null;
  meta: any;
  duration_ms: number | null;
  cursor_changed_at: string | null;
  cursor_external_id: string | null;
  repair_run_id: string | null;
  data_issues_count: number;
  system_errors_count: number;
  ai_errors_count: number;
};

export type NavUpstreamHealth = {
  fetched_ok: boolean;
  error?: string;
  inventory?: {
    total: number;
    active: number;
    inactive: number;
    active_with_detail: number;
    active_missing_detail: number;
    active_expired: number;
    active_without_expiry: number;
    duplicate_external_ids: number;
    latest_source_event_at: string | null;
    source_event_lag_seconds: number | null;
  };
  steady_state?: {
    feed_url: string | null;
    has_etag: boolean | null;
    heartbeat_at: string | null;
    pages_fetched: number | null;
    error: string | null;
  };
  reconcile?: {
    run_id: string | null;
    status: string | null;
    pages_fetched: number | null;
    events_processed: number | null;
    current_feed_url: string | null;
    tail_reached: boolean | null;
    started_at: string | null;
  };
  detail_retry?: { pending: number; abandoned: number };
  leases?: { name: string; mode: string | null; status: string | null }[];
};

export type NavUpstreamCron = {
  fetched_ok: boolean;
  error?: string;
  jobs: { jobname: string; schedule: string | null; active: boolean }[];
};

export type NavTargetInventory = {
  total: number;
  active: number;
  inactive: number;
  active_with_detail: number;
  active_missing_detail: number;
  active_with_extent: number;
  active_with_engagement: number;
  active_with_event_version: number;
  rows_with_event_version: number;
  duplicate_external_ids: number;
  max_last_seen_at: string | null;
  max_source_event_version: string | null;
};

export type NavRepairProgress = {
  active: {
    id: string;
    started_at: string;
    status: string;
    cursor_after_external_id: string;
    batches: number;
    ids_requested: number;
    ids_found: number;
    ids_missing: number;
    rows_merged: number;
    rows_noop: number;
    rows_stale: number;
    rows_failed: number;
  } | null;
  last_completed: { id: string; finished_at: string | null; status: string } | null;
};

export type NavSyncStatus = {
  now: string;
  runs: NavSyncRunRow[];
  cron: { jobname: string; schedule: string | null; active: boolean | null } | null;
  vault: { status: "present" | "missing" | "check_error"; error?: string };
  duplicates: {
    source_postings_nav: number;
    distinct_external_ids: number;
    duplicate_external_ids: { external_id: string; count: number }[];
  };
  quality: {
    nav_source_postings: number;
    nav_source_postings_missing_nav_detail: number;
    nav_canonical_total: number;
    nav_canonical_with_grace: number;
    nav_canonical_expired_visible: number;
    user_opportunities_nav: number;
    inactive_source_postings: number;
  };
  cursor_progress: {
    latest_run_cursor_changed_at: string | null;
    latest_run_cursor_external_id: string | null;
    last_successful_cursor_run_id: string | null;
    last_successful_cursor_finished_at: string | null;
    max_source_posting_last_seen_at: string | null;
  };
  target_inventory: NavTargetInventory | null;
  upstream_health: NavUpstreamHealth;
  upstream_cron: NavUpstreamCron;
  repair: NavRepairProgress;
  active_diff: {
    upstream_active: number | null;
    target_active: number | null;
    diff: number | null;
  };
  lease: NavTargetLease;
  repair_cron: NavRepairCron;
};
export type NavTargetLease = {
  lease_name: string;
  run_id: string;
  mode: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  is_stale: boolean;
} | null;

export type NavRepairCron = {
  jobname: string;
  schedule: string | null;
  active: boolean;
} | null;


// --- Upstream proxy ---------------------------------------------------------

async function callUpstreamRpc(fn: string, body: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  const url = process.env.NAV_SOURCE_SUPABASE_URL;
  const key = process.env.NAV_SOURCE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "missing NAV_SOURCE env" };
  try {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status}: ${text.slice(0, 200)}` };
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function sanitizeUpstreamHealth(raw: any): NavUpstreamHealth {
  if (!raw || typeof raw !== "object") {
    return { fetched_ok: true, leases: [], detail_retry: { pending: 0, abandoned: 0 } };
  }
  const inv = (raw.inventory && typeof raw.inventory === "object") ? raw.inventory : null;
  const ss = (raw.steady_state && typeof raw.steady_state === "object") ? raw.steady_state : null;
  const rc = (raw.reconcile && typeof raw.reconcile === "object") ? raw.reconcile : null;
  const dr = (raw.detail_retry && typeof raw.detail_retry === "object") ? raw.detail_retry : null;
  const leasesRaw = Array.isArray(raw.leases) ? raw.leases : [];
  return {
    fetched_ok: true,
    inventory: inv ? {
      total: Number(inv.total ?? 0),
      active: Number(inv.active ?? 0),
      inactive: Number(inv.inactive ?? 0),
      active_with_detail: Number(inv.active_with_detail ?? 0),
      active_missing_detail: Number(inv.active_missing_detail ?? 0),
      active_expired: Number(inv.active_expired ?? 0),
      active_without_expiry: Number(inv.active_without_expiry ?? 0),
      duplicate_external_ids: Number(inv.duplicate_external_ids ?? 0),
      latest_source_event_at: inv.latest_source_event_at ?? null,
      source_event_lag_seconds: inv.source_event_lag_seconds != null
        ? Number(inv.source_event_lag_seconds) : null,
    } : undefined,
    steady_state: ss ? {
      feed_url: typeof ss.feed_url === "string" ? ss.feed_url : null,
      has_etag: typeof ss.has_etag === "boolean" ? ss.has_etag : null,
      heartbeat_at: ss.heartbeat_at ?? null,
      pages_fetched: ss.pages_fetched != null ? Number(ss.pages_fetched) : null,
      error: typeof ss.error === "string" ? ss.error : null,
    } : undefined,
    reconcile: rc ? {
      run_id: typeof rc.run_id === "string" ? rc.run_id : (rc.id ?? null),
      status: typeof rc.status === "string" ? rc.status : null,
      pages_fetched: rc.pages_fetched != null ? Number(rc.pages_fetched) : null,
      events_processed: rc.events_processed != null ? Number(rc.events_processed) : null,
      current_feed_url: typeof rc.current_feed_url === "string" ? rc.current_feed_url : null,
      tail_reached: typeof rc.tail_reached === "boolean" ? rc.tail_reached : null,
      started_at: rc.started_at ?? null,
    } : undefined,
    detail_retry: dr ? {
      pending: Number(dr.pending ?? 0),
      abandoned: Number(dr.abandoned ?? 0),
    } : { pending: 0, abandoned: 0 },
    leases: leasesRaw.map((l: any) => ({
      name: String(l?.name ?? l?.lock_name ?? "?"),
      mode: l?.mode ?? l?.run_mode ?? null,
      status: l?.status ?? null,
    })),
  };
}

// --- Trigger removed -------------------------------------------------------
// /admin/sync is fully read-only. Repair runs are driven automatically by
// pg_cron job nav-target-repair-3min (SECURITY DEFINER dispatcher), and
// cursor-sync continues via nav-sync-30min. No client-callable mutation.



// --- Main status server fn --------------------------------------------------

export const getNavSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NavSyncStatus> => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const { data: runs, error: runsErr } = await supabaseAdmin
      .from("nav_sync_runs")
      .select("id, started_at, finished_at, error_summary, fetched, upserted, expired, reactivated, matched_user_opps, scored, meta")
      .order("started_at", { ascending: false })
      .limit(50);
    if (runsErr) throw new Error(`runs: ${runsErr.message}`);

    const enrichedRuns: NavSyncRunRow[] = (runs ?? []).map((r: any) => {
      const meta = (r.meta ?? {}) as Record<string, any>;
      const dataIssues = Array.isArray(meta.dataIssues) ? meta.dataIssues : [];
      const systemErrors = Array.isArray(meta.systemErrors) ? meta.systemErrors : [];
      const aiErrors = Array.isArray(meta.aiErrors) ? meta.aiErrors : [];
      const start = r.started_at ? new Date(r.started_at).getTime() : null;
      const end = r.finished_at ? new Date(r.finished_at).getTime() : null;
      return {
        id: r.id,
        started_at: r.started_at,
        finished_at: r.finished_at,
        error_summary: r.error_summary,
        mode: typeof meta.mode === "string" ? meta.mode : "cursor",
        fetched: r.fetched ?? null,
        upserted: r.upserted ?? null,
        expired: r.expired ?? null,
        reactivated: r.reactivated ?? null,
        matched_user_opps: r.matched_user_opps ?? null,
        scored: r.scored ?? null,
        noop: meta.noop != null ? Number(meta.noop) : null,
        stale: meta.stale != null ? Number(meta.stale) : null,
        meta,
        duration_ms: start && end ? end - start : null,
        cursor_changed_at: typeof meta.cursor_changed_at === "string" ? meta.cursor_changed_at : null,
        cursor_external_id: typeof meta.cursor_external_id === "string" ? meta.cursor_external_id : null,
        repair_run_id: typeof meta.repair_run_id === "string" ? meta.repair_run_id : null,
        data_issues_count: dataIssues.length,
        system_errors_count: systemErrors.length,
        ai_errors_count: aiErrors.length,
      };
    });

    let cron: NavSyncStatus["cron"] = null;
    try {
      const { data: cronRows } = await supabaseAdmin.rpc("get_nav_sync_cron_info");
      if (Array.isArray(cronRows) && cronRows.length) {
        const c = cronRows[0] as any;
        cron = { jobname: c.jobname, schedule: c.schedule, active: c.active };
      }
    } catch { /* noop */ }

    let vault = { has_sync_nav_secret: false };
    try {
      const { data: vaultRes } = await supabaseAdmin.rpc("nav_sync_vault_has_secret");
      vault.has_sync_nav_secret = Boolean(vaultRes);
    } catch { /* noop */ }

    const { data: dupRows } = await supabaseAdmin.rpc("nav_sync_duplicate_external_ids");
    const duplicate_external_ids = Array.isArray(dupRows)
      ? (dupRows as any[]).map((r) => ({ external_id: r.external_id, count: Number(r.count ?? 0) }))
      : [];

    const { count: spNavCount } = await supabaseAdmin
      .from("source_postings").select("id", { count: "exact", head: true }).eq("source", "nav");
    const { data: distinctRow } = await supabaseAdmin.rpc("nav_sync_distinct_external_count");
    const distinct_external_ids = Number((distinctRow as any) ?? 0);
    const { data: missingDetailRow } = await supabaseAdmin.rpc("nav_sync_count_missing_nav_detail");
    const missingDetail = Number((missingDetailRow as any) ?? 0);

    const { count: canonTotal } = await supabaseAdmin
      .from("canonical_opportunities").select("id", { count: "exact", head: true }).eq("primary_source", "nav");
    const { count: canonWithGrace } = await supabaseAdmin
      .from("canonical_opportunities").select("id", { count: "exact", head: true })
      .eq("primary_source", "nav").not("live_until", "is", null);
    const nowIso = new Date().toISOString();
    const { count: canonExpiredVisible } = await supabaseAdmin
      .from("canonical_opportunities").select("id", { count: "exact", head: true })
      .eq("primary_source", "nav").not("live_until", "is", null).gt("live_until", nowIso);
    const { count: userOppsNav } = await supabaseAdmin
      .from("user_opportunities").select("id", { count: "exact", head: true }).eq("card_source", "nav");
    const { count: inactiveSp } = await supabaseAdmin
      .from("source_postings").select("id", { count: "exact", head: true })
      .eq("source", "nav").in("posting_status", ["expired", "removed"]);

    const { data: maxSeen } = await supabaseAdmin
      .from("source_postings").select("last_seen_at").eq("source", "nav")
      .order("last_seen_at", { ascending: false }).limit(1);
    const max_source_posting_last_seen_at =
      Array.isArray(maxSeen) && maxSeen.length ? (maxSeen[0] as any).last_seen_at : null;

    // Target inventory + cursor + repair progress
    let target_inventory: NavTargetInventory | null = null;
    try {
      const { data: invRows } = await supabaseAdmin.rpc("nav_sync_target_inventory");
      if (Array.isArray(invRows) && invRows.length) {
        const i = invRows[0] as any;
        target_inventory = {
          total: Number(i.total ?? 0),
          active: Number(i.active ?? 0),
          inactive: Number(i.inactive ?? 0),
          active_with_detail: Number(i.active_with_detail ?? 0),
          active_missing_detail: Number(i.active_missing_detail ?? 0),
          active_with_extent: Number(i.active_with_extent ?? 0),
          active_with_engagement: Number(i.active_with_engagement ?? 0),
          active_with_event_version: Number(i.active_with_event_version ?? 0),
          rows_with_event_version: Number(i.rows_with_event_version ?? 0),
          duplicate_external_ids: Number(i.duplicate_external_ids ?? 0),
          max_last_seen_at: i.max_last_seen_at ?? null,
          max_source_event_version: i.max_source_event_version ?? null,
        };
      }
    } catch { /* noop */ }

    let cursor_progress = {
      latest_run_cursor_changed_at: null as string | null,
      latest_run_cursor_external_id: null as string | null,
      last_successful_cursor_run_id: null as string | null,
      last_successful_cursor_finished_at: null as string | null,
      max_source_posting_last_seen_at,
    };
    try {
      const { data: curRows } = await supabaseAdmin.rpc("nav_sync_target_cursor");
      if (Array.isArray(curRows) && curRows.length) {
        const c = curRows[0] as any;
        cursor_progress.latest_run_cursor_changed_at = c.latest_cursor_changed_at ?? null;
        cursor_progress.latest_run_cursor_external_id = c.latest_cursor_external_id ?? null;
        cursor_progress.last_successful_cursor_run_id = c.last_successful_run_id ?? null;
        cursor_progress.last_successful_cursor_finished_at = c.last_successful_finished_at ?? null;
      }
    } catch { /* noop */ }

    let repair: NavRepairProgress = { active: null, last_completed: null };
    try {
      const { data: progRows } = await supabaseAdmin.rpc("nav_sync_repair_progress");
      if (Array.isArray(progRows) && progRows.length) {
        const p = progRows[0] as any;
        repair = {
          active: p.active_run_id ? {
            id: p.active_run_id,
            started_at: p.active_run_started_at,
            status: p.active_run_status,
            cursor_after_external_id: p.active_run_cursor_after ?? "",
            batches: Number(p.active_run_batches ?? 0),
            ids_requested: Number(p.active_run_ids_requested ?? 0),
            ids_found: Number(p.active_run_ids_found ?? 0),
            ids_missing: Number(p.active_run_ids_missing ?? 0),
            rows_merged: Number(p.active_run_rows_merged ?? 0),
            rows_noop: Number(p.active_run_rows_noop ?? 0),
            rows_stale: Number(p.active_run_rows_stale ?? 0),
            rows_failed: Number(p.active_run_rows_failed ?? 0),
          } : null,
          last_completed: p.last_completed_id ? {
            id: p.last_completed_id,
            finished_at: p.last_completed_finished_at ?? null,
            status: p.last_completed_status ?? "",
          } : null,
        };
      }
    } catch { /* noop */ }

    // Upstream health + cron (admin-gated proxy; no secrets to client)
    const healthRes = await callUpstreamRpc("get_nav_source_health", {});
    const upstream_health: NavUpstreamHealth = healthRes.ok
      ? sanitizeUpstreamHealth(healthRes.data)
      : { fetched_ok: false, error: healthRes.error, leases: [], detail_retry: { pending: 0, abandoned: 0 } };

    const cronRes = await callUpstreamRpc("get_nav_source_cron_health", {});
    const upstream_cron: NavUpstreamCron = cronRes.ok
      ? {
        fetched_ok: true,
        jobs: Array.isArray(cronRes.data)
          ? (cronRes.data as any[]).map((j) => ({
              jobname: String(j.jobname ?? "?"),
              schedule: typeof j.schedule === "string" ? j.schedule : null,
              active: Boolean(j.active),
            }))
          : [],
      }
      : { fetched_ok: false, error: cronRes.error, jobs: [] };

    const upstream_active = upstream_health.inventory?.active ?? null;
    const target_active = target_inventory?.active ?? null;
    const diff = (upstream_active != null && target_active != null)
      ? (target_active - upstream_active) : null;

    // Global target writer lease + temporary repair-cron status
    let lease: NavTargetLease = null;
    try {
      const { data: lr } = await supabaseAdmin.rpc("nav_target_lease_status");
      if (Array.isArray(lr) && lr.length) {
        const l = lr[0] as any;
        lease = {
          lease_name: String(l.lease_name),
          run_id: String(l.run_id),
          mode: String(l.mode),
          acquired_at: l.acquired_at,
          heartbeat_at: l.heartbeat_at,
          expires_at: l.expires_at,
          is_stale: Boolean(l.is_stale),
        };
      }
    } catch { /* noop */ }

    let repair_cron: NavRepairCron = null;
    try {
      const { data: rc } = await supabaseAdmin.rpc("get_nav_repair_cron_info");
      if (Array.isArray(rc) && rc.length) {
        const c = rc[0] as any;
        repair_cron = { jobname: String(c.jobname), schedule: c.schedule ?? null, active: Boolean(c.active) };
      }
    } catch { /* noop */ }


    return {
      now: nowIso,
      runs: enrichedRuns,
      cron,
      vault,
      duplicates: {
        source_postings_nav: spNavCount ?? 0,
        distinct_external_ids,
        duplicate_external_ids,
      },
      quality: {
        nav_source_postings: spNavCount ?? 0,
        nav_source_postings_missing_nav_detail: missingDetail ?? 0,
        nav_canonical_total: canonTotal ?? 0,
        nav_canonical_with_grace: canonWithGrace ?? 0,
        nav_canonical_expired_visible: canonExpiredVisible ?? 0,
        user_opportunities_nav: userOppsNav ?? 0,
        inactive_source_postings: inactiveSp ?? 0,
      },
      cursor_progress,
      target_inventory,
      upstream_health,
      upstream_cron,
      repair,
      active_diff: { upstream_active, target_active, diff },
      lease,
      repair_cron,
    };
  });
