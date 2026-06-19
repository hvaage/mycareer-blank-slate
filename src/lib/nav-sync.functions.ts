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
  fetched: number | null;
  upserted: number | null;
  expired: number | null;
  reactivated: number | null;
  matched_user_opps: number | null;
  scored: number | null;
  meta: any;
  duration_ms: number | null;
  cursor_changed_at: string | null;
  cursor_external_id: string | null;
  data_issues_count: number;
  system_errors_count: number;
  ai_errors_count: number;
};

export type NavSyncStatus = {
  now: string;
  runs: NavSyncRunRow[];
  cron: {
    jobname: string;
    schedule: string | null;
    active: boolean | null;
  } | null;
  vault: { has_sync_nav_secret: boolean };
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
    max_source_posting_last_seen_at: string | null;
  };
};

export const getNavSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NavSyncStatus> => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    // Last 50 runs
    const { data: runs, error: runsErr } = await supabaseAdmin
      .from("nav_sync_runs")
      .select(
        "id, started_at, finished_at, error_summary, fetched, upserted, expired, reactivated, matched_user_opps, scored, meta"
      )
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
      const duration_ms = start && end ? end - start : null;
      return {
        id: r.id,
        started_at: r.started_at,
        finished_at: r.finished_at,
        error_summary: r.error_summary,
        fetched: r.fetched ?? null,
        upserted: r.upserted ?? null,
        expired: r.expired ?? null,
        reactivated: r.reactivated ?? null,
        matched_user_opps: r.matched_user_opps ?? null,
        scored: r.scored ?? null,
        meta,
        duration_ms,
        cursor_changed_at: typeof meta.cursor_changed_at === "string" ? meta.cursor_changed_at : null,
        cursor_external_id: typeof meta.cursor_external_id === "string" ? meta.cursor_external_id : null,
        data_issues_count: dataIssues.length,
        system_errors_count: systemErrors.length,
        ai_errors_count: aiErrors.length,
      };
    });

    // Cron job
    let cron: NavSyncStatus["cron"] = null;
    try {
      const { data: cronRows } = await supabaseAdmin.rpc("get_nav_sync_cron_info");
      if (Array.isArray(cronRows) && cronRows.length) {
        const c = cronRows[0] as any;
        cron = {
          jobname: c.jobname,
          schedule: c.schedule,
          active: c.active,
        };
      }
    } catch {
      cron = null;
    }

    // Vault check
    let vault = { has_sync_nav_secret: false };
    try {
      const { data: vaultRes } = await supabaseAdmin.rpc("nav_sync_vault_has_secret");
      vault.has_sync_nav_secret = Boolean(vaultRes);
    } catch {
      // ignore
    }

    // Duplicate + quality checks
    const { data: dupRows } = await supabaseAdmin.rpc("nav_sync_duplicate_external_ids");
    const duplicate_external_ids = Array.isArray(dupRows)
      ? (dupRows as any[]).map((r) => ({
          external_id: r.external_id,
          count: Number(r.count ?? 0),
        }))
      : [];

    const { count: spNavCount } = await supabaseAdmin
      .from("source_postings")
      .select("id", { count: "exact", head: true })
      .eq("source", "nav");

    const { data: distinctRow } = await supabaseAdmin.rpc("nav_sync_distinct_external_count");
    const distinct_external_ids = Number((distinctRow as any) ?? 0);

    const { count: missingDetail } = await supabaseAdmin
      .from("source_postings")
      .select("id", { count: "exact", head: true })
      .eq("source", "nav")
      .is("raw_payload->nav_detail", null);

    const { count: canonTotal } = await supabaseAdmin
      .from("canonical_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("primary_source", "nav");

    const { count: canonWithGrace } = await supabaseAdmin
      .from("canonical_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("primary_source", "nav")
      .not("live_until", "is", null);

    const nowIso = new Date().toISOString();
    const { count: canonExpiredVisible } = await supabaseAdmin
      .from("canonical_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("primary_source", "nav")
      .not("live_until", "is", null)
      .gt("live_until", nowIso);

    const { count: userOppsNav } = await supabaseAdmin
      .from("user_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("card_source", "nav");

    const { count: inactiveSp } = await supabaseAdmin
      .from("source_postings")
      .select("id", { count: "exact", head: true })
      .eq("source", "nav")
      .in("posting_status", ["expired", "removed"]);

    const { data: maxSeen } = await supabaseAdmin
      .from("source_postings")
      .select("last_seen_at")
      .eq("source", "nav")
      .order("last_seen_at", { ascending: false })
      .limit(1);
    const max_source_posting_last_seen_at =
      Array.isArray(maxSeen) && maxSeen.length ? (maxSeen[0] as any).last_seen_at : null;

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
      cursor_progress: {
        latest_run_cursor_changed_at: enrichedRuns[0]?.cursor_changed_at ?? null,
        latest_run_cursor_external_id: enrichedRuns[0]?.cursor_external_id ?? null,
        max_source_posting_last_seen_at,
      },
    };
  });
