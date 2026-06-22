// sync-careerjet-opportunities — A1/A5 identity-resolver rollout
//
// Writes go ONLY through public.careerjet_resolve_listing under an active
// careerjet_writer_leases entry (lease_name='careerjet_global') with a
// monotonic fencing_token. No direct writes to source_postings,
// canonical_opportunities or opportunity_source_links are allowed in this
// function. NAV, e-post, LinkedIn are untouched.
//
// Modes:
//   normal canary/production: { canary?: boolean, max_distinct_fingerprints?: number,
//                               terms_per_run?, pages_per_term? }
//   canary stops at exactly `max_distinct_fingerprints` distinct valid fingerprints
//   (default 50). Reports fetched, distinct, duplicates, missing-fp, action breakdown,
//   audit row counts, lease/fencing, and edge-write witness counters.
//
// Auth: x-sync-careerjet-secret (constant-time compare).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_CAREERJET_SECRET = Deno.env.get("SYNC_CAREERJET_SECRET") ?? "";
const CAREERJET_AFFID = Deno.env.get("CAREERJET_AFFID") ?? "";

const STALE_LOCK_MINUTES = 60;
const RUN_TIME_BUDGET_MS = 130_000;
const DEFAULT_TERMS_PER_RUN = 20;
const DEFAULT_PAGES_PER_TERM = 3;
const DEFAULT_CANARY_DISTINCT = 50;
const LEASE_NAME = "careerjet_global";
const LEASE_TTL_SECONDS = 180;
const HEARTBEAT_INTERVAL_MS = 30_000;
const FP_VERSION = 1;

const CAREERJET_USER_AGENT = "karrierenmin.no/1.0";
const CAREERJET_USER_IP = "1.1.1.1";
const CAREERJET_REFERER = "https://karrierenmin.no/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-careerjet-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < ab.length ? ab[i] : 0) ^ (i < bb.length ? bb[i] : 0);
  }
  return diff === 0;
}

function computeFingerprintLocal(company: string, title: string, location: string | null): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const key = `cmp:${norm(company)}|${norm(title)}|${norm(location ?? "")}`;
  return "fp1:" + createHash("md5").update(key).digest("hex");
}

function normalizeUrlForDedupe(raw: string): string {
  let u = (raw ?? "").trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/[?#].*$/, "");
  u = u.replace(/\/+$/, "");
  u = u.replace(/^www\./, "");
  return u;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type CjRow = {
  jobkey?: string | null;
  url?: string | null;
  title?: string | null;
  company?: string | null;
  locations?: string | null;
  date?: string | null;
  description?: string | null;
  salary?: string | null;
  site?: string | null;
};

async function fetchCareerjetPage(opts: {
  term: string;
  locale: string;
  location: string | null;
  page: number;
}): Promise<{ rows: CjRow[]; status: number; error?: string }> {
  const params = new URLSearchParams();
  params.set("affid", CAREERJET_AFFID);
  params.set("keywords", opts.term);
  if (opts.location) params.set("location", opts.location);
  params.set("locale_code", opts.locale);
  params.set("pagesize", "20");
  params.set("page", String(opts.page));
  params.set("user_ip", CAREERJET_USER_IP);
  params.set("user_agent", CAREERJET_USER_AGENT);
  params.set("sort", "date");
  try {
    const res = await fetch(`http://public.api.careerjet.net/search?${params.toString()}`, {
      method: "GET",
      headers: { Referer: CAREERJET_REFERER, Accept: "application/json" },
    });
    if (!res.ok) return { rows: [], status: res.status, error: `http ${res.status}` };
    const data: any = await res.json();
    if (data?.type === "ERROR") {
      return { rows: [], status: res.status, error: String(data?.error ?? "api error") };
    }
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return { rows: jobs as CjRow[], status: res.status };
  } catch (e: any) {
    return { rows: [], status: 0, error: String(e?.message ?? e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const provided = req.headers.get("x-sync-careerjet-secret") ?? "";
  if (!SYNC_CAREERJET_SECRET || !provided || !timingSafeEqualStr(provided, SYNC_CAREERJET_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "missing supabase env" }, 500);
  if (!CAREERJET_AFFID) return json({ ok: false, error: "missing CAREERJET_AFFID" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Body opts
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const canary: boolean = body?.canary === true;
  const maxDistinct: number = Math.max(1, Math.min(1000, Number(body?.max_distinct_fingerprints) || DEFAULT_CANARY_DISTINCT));
  const termsPerRun: number = Math.max(1, Math.min(60, Number(body?.terms_per_run) || (canary ? 12 : DEFAULT_TERMS_PER_RUN)));
  const pagesPerTerm: number = Math.max(1, Math.min(10, Number(body?.pages_per_term) || (canary ? 3 : DEFAULT_PAGES_PER_TERM)));

  // Concurrency guard via in-flight run
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  const { data: inflight } = await admin
    .from("careerjet_sync_runs")
    .select("id, started_at")
    .is("finished_at", null)
    .gte("started_at", staleCutoff)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inflight) {
    return json({ ok: true, status: "already_running", inflight_run_id: inflight.id, started_at: inflight.started_at });
  }

  // Create run row to get run_id (uuid) for lease + audit
  const { data: runRow, error: runErr } = await admin
    .from("careerjet_sync_runs")
    .insert({
      status: "running",
      meta: { mode: canary ? "canary" : "production", terms_per_run: termsPerRun, pages_per_term: pagesPerTerm, max_distinct_fingerprints: maxDistinct },
    })
    .select("id")
    .single();
  if (runErr || !runRow) return json({ ok: false, error: `run insert failed: ${runErr?.message}` }, 500);
  const runId = runRow.id as string;

  // Claim writer lease
  const { data: leaseRes, error: leaseErr } = await admin.rpc("careerjet_lease_claim", {
    p_lease_name: LEASE_NAME, p_run_id: runId, p_ttl_seconds: LEASE_TTL_SECONDS,
  });
  if (leaseErr) {
    await admin.from("careerjet_sync_runs").update({
      finished_at: new Date().toISOString(), status: "failed",
      error_summary: `lease_claim error: ${leaseErr.message}`,
    }).eq("id", runId);
    return json({ ok: false, error: `lease_claim: ${leaseErr.message}` }, 500);
  }
  const lease = Array.isArray(leaseRes) ? leaseRes[0] : leaseRes;
  if (!lease?.granted) {
    await admin.from("careerjet_sync_runs").update({
      finished_at: new Date().toISOString(), status: "failed",
      error_summary: `lease_not_granted: ${lease?.reason ?? "unknown"}`,
    }).eq("id", runId);
    return json({ ok: false, error: "lease_not_granted", reason: lease?.reason ?? null, holder_run_id: lease?.run_id ?? null }, 409);
  }
  const fencingToken: number = Number(lease.fencing_token);

  // Heartbeat
  const heartbeatTimer = setInterval(async () => {
    try {
      await admin.rpc("careerjet_lease_heartbeat", {
        p_lease_name: LEASE_NAME, p_run_id: runId,
        p_fencing_token: fencingToken, p_ttl_seconds: LEASE_TTL_SECONDS,
      });
    } catch { /* swallow */ }
  }, HEARTBEAT_INTERVAL_MS);

  // Witness counters for direct writes done by THIS function (should stay 0).
  // The function never calls these tables, so we record before/after counts
  // via the response only; here we simply do NOT touch them.
  const tStart = Date.now();
  let rowsFetched = 0;
  let termsCovered = 0;
  const distinctFps = new Set<string>();
  let duplicateObservations = 0;
  let missingFp = 0;
  const actionCounts: Record<string, number> = { first_sight: 0, re_seen_noop: 0, re_seen_changed: 0, review: 0 };
  const reviewIds = new Set<string>();
  const apiErrors: any[] = [];
  const resolverErrors: any[] = [];
  let heartbeatCalls = 0; // counted via interval
  let lastTerm: string | null = null;
  let lastPage: number | null = null;
  let stopReason: string = "completed";
  let status: "success" | "partial" | "failed" = "success";
  let errorSummary: string | null = null;

  // Track heartbeat-call count by replacing the closure
  clearInterval(heartbeatTimer);
  const heartbeatTimer2 = setInterval(async () => {
    heartbeatCalls++;
    try {
      await admin.rpc("careerjet_lease_heartbeat", {
        p_lease_name: LEASE_NAME, p_run_id: runId,
        p_fencing_token: fencingToken, p_ttl_seconds: LEASE_TTL_SECONDS,
      });
    } catch { /* swallow */ }
  }, HEARTBEAT_INTERVAL_MS);

  // Capture before-counters for the "no direct edge writes" invariant
  const [{ count: spBefore }, { count: coBefore }, { count: linkBefore }, { count: auditBefore }] = await Promise.all([
    admin.from("source_postings").select("id", { count: "exact", head: true }).eq("source", "careerjet"),
    admin.from("canonical_opportunities").select("id", { count: "exact", head: true }).eq("primary_source", "careerjet"),
    admin.from("opportunity_source_links").select("id", { count: "exact", head: true }),
    admin.from("careerjet_identity_audit").select("id", { count: "exact", head: true }),
  ]);
  const { count: userOppBefore } = await admin
    .from("user_opportunities").select("id", { count: "exact", head: true }).eq("card_source", "careerjet");
  const { count: aiScoredBefore } = await admin
    .from("user_opportunities").select("id", { count: "exact", head: true })
    .eq("card_source", "careerjet").not("ai_scored_at", "is", null);

  try {
    const { data: terms, error: termsErr } = await admin
      .from("careerjet_search_terms")
      .select("id, term, locale, location, last_run_at")
      .eq("active", true)
      .order("last_run_at", { ascending: true, nullsFirst: true })
      .order("priority", { ascending: false })
      .limit(termsPerRun);
    if (termsErr) throw new Error(`terms query failed: ${termsErr.message}`);

    outer: for (const t of (terms ?? [])) {
      lastTerm = t.term;
      termsCovered++;
      for (let p = 1; p <= pagesPerTerm; p++) {
        lastPage = p;
        if (Date.now() - tStart > RUN_TIME_BUDGET_MS) { stopReason = "time_budget"; status = "partial"; break outer; }
        if (canary && distinctFps.size >= maxDistinct) { stopReason = "canary_target_reached"; break outer; }

        const { rows, status: httpStatus, error } = await fetchCareerjetPage({
          term: t.term, locale: t.locale ?? "no_NO",
          location: t.location ?? null, page: p,
        });
        if (error) {
          apiErrors.push({ term: t.term, page: p, status: httpStatus, error });
          if (httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) {
            status = "failed"; errorSummary = `careerjet api: ${error}`;
            stopReason = "api_failure"; break outer;
          }
          continue;
        }
        rowsFetched += rows.length;
        if (rows.length === 0) break; // no more pages

        for (const row of rows) {
          if (canary && distinctFps.size >= maxDistinct) { stopReason = "canary_target_reached"; break outer; }

          const title = (row.title ?? "").trim();
          const company = (row.company ?? "").trim();
          if (!title || !company) continue; // skip blank — not a valid identity
          const location = (row.locations ?? "").trim() || null;
          const fp = computeFingerprintLocal(company, title, location);
          if (!fp) { missingFp++; continue; }

          // Build observation aliases (raw URL hash)
          const rawUrl = (row.url ?? "").trim();
          const displayUrl = rawUrl || `https://www.careerjet.no/sok/jobber?s=${encodeURIComponent(title)}`;
          const rawUrlNorm = normalizeUrlForDedupe(displayUrl);
          const rawUrlHash = await sha256Hex(rawUrlNorm);

          // Compose source_posting_in jsonb
          const sourcePostingIn: Record<string, unknown> = {
            raw_url: rawUrl, display_url: displayUrl, raw_url_hash: rawUrlHash,
            title, company, location,
            description_excerpt: row.description ? String(row.description).slice(0, 800) : null,
            published_at: row.date ? new Date(row.date).toISOString() : null,
            site: row.site ?? null,
            employment: {},
          };

          const observationAliases = [{ raw_url_hash: rawUrlHash, raw_url_norm: rawUrlNorm, raw_url_sample: displayUrl.slice(0, 500) }];
          const observationTerms = [{ cursor_term: t.term, rank_in_term: p }];

          const { data: rRes, error: rErr } = await admin.rpc("careerjet_resolve_listing", {
            p_run_id: runId,
            p_fencing_token: fencingToken,
            p_fp_version: FP_VERSION,
            p_identity_fingerprint: fp,
            p_source_posting_in: sourcePostingIn,
            p_observation_aliases: observationAliases,
            p_observation_terms: observationTerms,
          });

          if (rErr) {
            resolverErrors.push({ fp, err: rErr.message });
            continue;
          }
          const action = String((rRes as any)?.action ?? "unknown");
          actionCounts[action] = (actionCounts[action] ?? 0) + 1;
          if (action === "review") {
            const rid = (rRes as any)?.review_id;
            if (rid) reviewIds.add(String(rid));
            continue;
          }
          if (distinctFps.has(fp)) duplicateObservations++;
          else distinctFps.add(fp);
        }
      }

      // mark term as run (only outside canary, so canary doesn't perturb rotation)
      if (!canary) {
        await admin
          .from("careerjet_search_terms")
          .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", t.id);
      }
    }
  } catch (e: any) {
    status = "failed";
    errorSummary = `system: ${String(e?.message ?? e)}`;
    stopReason = "exception";
  } finally {
    clearInterval(heartbeatTimer2);
    // Conditional release: only release if our fencing token is current.
    try {
      await admin.rpc("careerjet_lease_release", {
        p_lease_name: LEASE_NAME, p_run_id: runId, p_fencing_token: fencingToken,
      });
    } catch { /* swallow */ }
  }

  // After-counters (witness)
  const [{ count: spAfter }, { count: coAfter }, { count: linkAfter }, { count: auditAfter }] = await Promise.all([
    admin.from("source_postings").select("id", { count: "exact", head: true }).eq("source", "careerjet"),
    admin.from("canonical_opportunities").select("id", { count: "exact", head: true }).eq("primary_source", "careerjet"),
    admin.from("opportunity_source_links").select("id", { count: "exact", head: true }),
    admin.from("careerjet_identity_audit").select("id", { count: "exact", head: true }),
  ]);
  const { count: userOppAfter } = await admin
    .from("user_opportunities").select("id", { count: "exact", head: true }).eq("card_source", "careerjet");
  const { count: aiScoredAfter } = await admin
    .from("user_opportunities").select("id", { count: "exact", head: true })
    .eq("card_source", "careerjet").not("ai_scored_at", "is", null);

  const direct_writes_outside_resolver = {
    canonical_opportunities_delta: (coAfter ?? 0) - (coBefore ?? 0),
    opportunity_source_links_delta: (linkAfter ?? 0) - (linkBefore ?? 0),
    user_opportunities_careerjet_delta: (userOppAfter ?? 0) - (userOppBefore ?? 0),
  };

  // Lease state (post-release)
  const { data: leaseState } = await admin
    .from("careerjet_writer_leases").select("lease_name, run_id, fencing_token, expires_at")
    .eq("lease_name", LEASE_NAME).maybeSingle();
  const leaseReleased = !leaseState || String(leaseState.run_id) !== String(runId) || Number(leaseState.fencing_token) !== fencingToken;

  const summary = {
    run_id: runId,
    mode: canary ? "canary" : "production",
    status,
    stop_reason: stopReason,
    error_summary: errorSummary,
    duration_ms: Date.now() - tStart,
    terms_per_run: termsPerRun,
    pages_per_term: pagesPerTerm,
    max_distinct_fingerprints: maxDistinct,
    terms_covered: termsCovered,
    last_term: lastTerm,
    last_page: lastPage,
    rows_fetched: rowsFetched,
    distinct_valid_fingerprints: distinctFps.size,
    duplicate_observations_in_run: duplicateObservations,
    missing_fingerprint_skipped: missingFp,
    actions: actionCounts,
    review_evidence_ids: Array.from(reviewIds),
    api_errors_count: apiErrors.length,
    resolver_errors_count: resolverErrors.length,
    resolver_errors_sample: resolverErrors.slice(0, 5),
    lease: { name: LEASE_NAME, fencing_token: fencingToken, ttl_seconds: LEASE_TTL_SECONDS, released: leaseReleased, heartbeat_calls: heartbeatCalls },
    audit_rows_inserted: (auditAfter ?? 0) - (auditBefore ?? 0),
    invariants: {
      no_direct_edge_writes_canonical: direct_writes_outside_resolver.canonical_opportunities_delta === 0,
      no_direct_edge_writes_links: direct_writes_outside_resolver.opportunity_source_links_delta === 0,
      no_direct_edge_writes_user_opps: direct_writes_outside_resolver.user_opportunities_careerjet_delta === 0,
      direct_writes_outside_resolver,
    },
    before_after: {
      source_postings_careerjet: { before: spBefore ?? 0, after: spAfter ?? 0, delta: (spAfter ?? 0) - (spBefore ?? 0) },
      canonical_opportunities_careerjet: { before: coBefore ?? 0, after: coAfter ?? 0, delta: (coAfter ?? 0) - (coBefore ?? 0) },
      opportunity_source_links_total: { before: linkBefore ?? 0, after: linkAfter ?? 0, delta: (linkAfter ?? 0) - (linkBefore ?? 0) },
      user_opportunities_careerjet: { before: userOppBefore ?? 0, after: userOppAfter ?? 0, delta: (userOppAfter ?? 0) - (userOppBefore ?? 0) },
      ai_scored_careerjet: { before: aiScoredBefore ?? 0, after: aiScoredAfter ?? 0, delta: (aiScoredAfter ?? 0) - (aiScoredBefore ?? 0) },
      careerjet_identity_audit: { before: auditBefore ?? 0, after: auditAfter ?? 0, delta: (auditAfter ?? 0) - (auditBefore ?? 0) },
    },
  };

  await admin.from("careerjet_sync_runs").update({
    finished_at: new Date().toISOString(),
    status,
    cursor_term: lastTerm,
    cursor_page: lastPage,
    rows_fetched: rowsFetched,
    rows_upserted: actionCounts.first_sight + actionCounts.re_seen_changed,
    rows_expired: 0,
    rows_reactivated: 0,
    rows_failed: resolverErrors.length + apiErrors.length,
    terms_covered: termsCovered,
    api_errors: apiErrors,
    error_summary: errorSummary,
    meta: summary,
  }).eq("id", runId);

  return json({ ok: status !== "failed", ...summary });
});
