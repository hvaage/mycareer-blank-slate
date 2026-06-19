// M5.7 sync-careerjet-opportunities
// Henter Careerjet-annonser via deres API, syncer inn i felles canonical-stack.
// Sletter ALDRI rader. INACTIVE / stale bevarer raw_payload + lifecycle_events.
// Auth: x-sync-careerjet-secret (konstant-tids sammenligning).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_CAREERJET_SECRET = Deno.env.get("SYNC_CAREERJET_SECRET") ?? "";
const CAREERJET_AFFID = Deno.env.get("CAREERJET_AFFID") ?? "";

const STALE_LOCK_MINUTES = 60;
const RUN_TIME_BUDGET_MS = 130_000;
const DEFAULT_TERMS_PER_RUN = 20;
const DEFAULT_PAGES_PER_TERM = 3;
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

// ===== Stabil ID-helper =====
function normalizeUrlForDedupe(raw: string): string {
  let u = raw.trim().toLowerCase();
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
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  site?: string | null;
};

async function computeExternalId(
  row: CjRow,
): Promise<{ id: string; prefix: "cj_id_" | "cj_url_" | "cj_fp_" }> {
  if (row.jobkey && String(row.jobkey).trim()) {
    return { id: `cj_id_${String(row.jobkey).trim()}`, prefix: "cj_id_" };
  }
  if (row.url && row.url.trim()) {
    const key = normalizeUrlForDedupe(row.url);
    const hex = await sha256Hex(key);
    return { id: `cj_url_${hex.slice(0, 16)}`, prefix: "cj_url_" };
  }
  const fp = [
    (row.company ?? "").trim().toLowerCase(),
    (row.title ?? "").trim().toLowerCase(),
    (row.locations ?? "").trim().toLowerCase(),
    row.date ?? "",
  ].join("|");
  const hex = await sha256Hex(fp);
  return { id: `cj_fp_${hex.slice(0, 16)}`, prefix: "cj_fp_" };
}

// ===== raw_payload merge-helper (eksplisitt, testet) =====
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && v !== null && Object.keys(v as object).length === 0) return true;
  return false;
}

function richerThan(incoming: unknown, existing: unknown): boolean {
  if (typeof incoming === "string" && typeof existing === "string") {
    return incoming.length > existing.length;
  }
  if (Array.isArray(incoming) && Array.isArray(existing)) {
    return incoming.length > existing.length;
  }
  if (
    typeof incoming === "object" && incoming !== null &&
    typeof existing === "object" && existing !== null &&
    !Array.isArray(incoming) && !Array.isArray(existing)
  ) {
    return Object.keys(incoming as object).length > Object.keys(existing as object).length;
  }
  return false;
}

export function mergeCareerjetPayload(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
  lifecycleEvent?: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing || typeof existing !== "object") {
    const base: Record<string, unknown> = { ...incoming };
    base.careerjet_lifecycle_events = lifecycleEvent ? [lifecycleEvent] : [];
    return base;
  }

  const out: Record<string, unknown> = { ...existing };
  const existingEvents = Array.isArray((existing as any).careerjet_lifecycle_events)
    ? ((existing as any).careerjet_lifecycle_events as unknown[])
    : [];

  for (const [k, vIncoming] of Object.entries(incoming)) {
    if (k === "careerjet_lifecycle_events") continue;
    if (k === "previous_expired_at") continue;
    const vExisting = out[k];
    if (isEmpty(vExisting) && !isEmpty(vIncoming)) {
      out[k] = vIncoming;
    } else if (!isEmpty(vExisting) && !isEmpty(vIncoming) && richerThan(vIncoming, vExisting)) {
      out[k] = vIncoming;
    } // else behold existing
  }

  out.careerjet_lifecycle_events = lifecycleEvent
    ? [...existingEvents, lifecycleEvent]
    : existingEvents;
  return out;
}

// ===== Selvtest av merge-helper =====
function runSelftest(): { ok: boolean; cases: Array<{ name: string; pass: boolean; detail?: string }> } {
  const cases: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // 1: existing rich + incoming sparse
  {
    const existing = { title: "Full Title", company: "ACME AS", description: "long desc..." };
    const incoming = { title: "", company: null, description: "" };
    const m = mergeCareerjetPayload(existing, incoming);
    const pass =
      m.title === "Full Title" && m.company === "ACME AS" && m.description === "long desc...";
    cases.push({ name: "existing-rich+incoming-sparse", pass, detail: pass ? "" : JSON.stringify(m) });
  }

  // 2: existing sparse + incoming rich
  {
    const existing = { title: "", company: null };
    const incoming = { title: "New Title", company: "ACME AS", url: "https://x" };
    const m = mergeCareerjetPayload(existing, incoming);
    const pass = m.title === "New Title" && m.company === "ACME AS" && m.url === "https://x";
    cases.push({ name: "existing-sparse+incoming-rich", pass, detail: pass ? "" : JSON.stringify(m) });
  }

  // 3: existing with 2 lifecycle events + new event
  {
    const existing = {
      title: "T",
      careerjet_lifecycle_events: [
        { event: "expired_by_stale", at: "2026-01-01" },
        { event: "reactivated", at: "2026-01-05" },
      ],
    };
    const incoming = { title: "T" };
    const m = mergeCareerjetPayload(existing, incoming, { event: "expired_by_stale", at: "2026-01-10" });
    const ev = Array.isArray(m.careerjet_lifecycle_events) ? m.careerjet_lifecycle_events : [];
    const pass = ev.length === 3 && (ev[2] as any).at === "2026-01-10";
    cases.push({ name: "lifecycle-append", pass, detail: pass ? "" : JSON.stringify(ev) });
  }

  // 4: existing null + incoming rich
  {
    const incoming = { title: "T", company: "C" };
    const m = mergeCareerjetPayload(null, incoming);
    const ev = Array.isArray(m.careerjet_lifecycle_events) ? m.careerjet_lifecycle_events : null;
    const pass = m.title === "T" && m.company === "C" && Array.isArray(ev) && ev.length === 0;
    cases.push({ name: "existing-null+incoming-rich", pass, detail: pass ? "" : JSON.stringify(m) });
  }

  return { ok: cases.every((c) => c.pass), cases };
}

// ===== Careerjet API =====
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
  params.set("contracttype", "");
  params.set("contractperiod", "");
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

  const url = new URL(req.url);

  // ===== Selftest (pre-auth: pure in-memory tests, no DB/network) =====
  if (url.searchParams.get("selftest") === "1") {
    return json({ ok: true, selftest: runSelftest() });
  }

  // ===== AUTH =====
  const provided = req.headers.get("x-sync-careerjet-secret") ?? "";
  if (!SYNC_CAREERJET_SECRET || !provided || !timingSafeEqualStr(provided, SYNC_CAREERJET_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }


  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing supabase env" }, 500);
  }
  if (!CAREERJET_AFFID) {
    return json({ ok: false, error: "missing CAREERJET_AFFID" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ===== Concurrency guard =====
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
    return json({
      ok: true,
      status: "already_running",
      inflight_run_id: inflight.id,
      started_at: inflight.started_at,
    });
  }

  // Body opts
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const termsPerRun: number = Math.max(1, Math.min(60, Number(body?.terms_per_run) || DEFAULT_TERMS_PER_RUN));
  const pagesPerTerm: number = Math.max(1, Math.min(10, Number(body?.pages_per_term) || DEFAULT_PAGES_PER_TERM));
  const dryRun = body?.dry_run === true;

  // Pick search terms (round-robin via last_run_at)
  const { data: terms, error: termsErr } = await admin
    .from("careerjet_search_terms")
    .select("id, term, locale, location, last_run_at")
    .eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false })
    .limit(termsPerRun);
  if (termsErr) {
    return json({ ok: false, error: `terms query failed: ${termsErr.message}` }, 500);
  }

  // ===== Create new run row =====
  const { data: runRow, error: runErr } = await admin
    .from("careerjet_sync_runs")
    .insert({
      status: "running",
      meta: {
        terms_per_run: termsPerRun,
        pages_per_term: pagesPerTerm,
        dry_run: dryRun,
        selftest: runSelftest(),
      },
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return json({ ok: false, error: `run insert failed: ${runErr?.message}` }, 500);
  }
  const runId = runRow.id as string;

  const tStart = Date.now();
  let rowsFetched = 0;
  let rowsUpserted = 0;
  let rowsReactivated = 0;
  let rowsFailed = 0;
  let termsCovered = 0;
  const apiErrors: any[] = [];
  const dataIssues: any[] = [];
  const prefixCounts: Record<string, number> = { cj_id_: 0, cj_url_: 0, cj_fp_: 0 };
  let lastTerm: string | null = null;
  let lastPage: number | null = null;
  let status: "success" | "partial" | "failed" = "success";
  let errorSummary: string | null = null;

  try {
    outer: for (const t of terms ?? []) {
      lastTerm = t.term;
      termsCovered++;
      for (let p = 1; p <= pagesPerTerm; p++) {
        lastPage = p;
        if (Date.now() - tStart > RUN_TIME_BUDGET_MS) {
          status = "partial";
          break outer;
        }
        const { rows, status: httpStatus, error } = await fetchCareerjetPage({
          term: t.term,
          locale: t.locale ?? "no_NO",
          location: t.location ?? null,
          page: p,
        });
        if (error) {
          apiErrors.push({ term: t.term, page: p, status: httpStatus, error });
          if (httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) {
            status = "failed";
            errorSummary = `careerjet api: ${error}`;
            break outer;
          }
          continue;
        }
        rowsFetched += rows.length;
        if (rows.length === 0) break; // no more pages for this term

        for (const row of rows) {
          try {
            const { id: extId, prefix } = await computeExternalId(row);
            prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;
            if (prefix === "cj_fp_") {
              dataIssues.push({ external_id: extId, reason: "no jobkey or url" });
            }
            const title = (row.title ?? "").trim();
            const company = (row.company ?? "").trim();
            if (!title || !company) {
              dataIssues.push({ external_id: extId, reason: "missing title/company" });
              continue;
            }

            const safeUrl =
              (row.url && row.url.trim()) ||
              `https://www.careerjet.no/jobbsoek?s=${encodeURIComponent(title)}`;
            const location = (row.locations ?? "").trim() || null;

            const { data: fpData, error: fpErr } = await admin.rpc("opportunity_fingerprint", {
              p_company: company,
              p_title: title,
              p_location: location ?? "",
            });
            if (fpErr) throw new Error(`fingerprint: ${fpErr.message}`);
            const fp = String(fpData);

            // Existing source posting
            const { data: existingSp } = await admin
              .from("source_postings")
              .select("id, raw_payload, posting_status, expired_at")
              .eq("source", "careerjet")
              .eq("source_external_id", extId)
              .maybeSingle();

            const wasExpired =
              existingSp?.posting_status === "expired" ||
              existingSp?.posting_status === "removed";
            const lifecycleEvent = wasExpired
              ? {
                  event: "reactivated",
                  at: new Date().toISOString(),
                  previous_expired_at: (existingSp as any)?.expired_at ?? null,
                }
              : undefined;

            const mergedPayload = mergeCareerjetPayload(
              (existingSp?.raw_payload as any) ?? null,
              row as Record<string, unknown>,
              lifecycleEvent,
            );

            if (dryRun) continue;

            const upsertRow: Record<string, unknown> = {
              source: "careerjet",
              source_external_id: extId,
              raw_url: safeUrl,
              display_url: safeUrl,
              title,
              company,
              location,
              description_excerpt: row.description ? String(row.description).slice(0, 800) : null,
              raw_payload: mergedPayload,
              identity_fingerprint: fp,
              published_at: row.date ? new Date(row.date).toISOString() : null,
              last_seen_at: new Date().toISOString(),
              posting_status: "active",
              expired_at: null,
              updated_at: new Date().toISOString(),
            };
            if (wasExpired) upsertRow.reactivated_at = new Date().toISOString();

            const { data: spUp, error: spErr } = await admin
              .from("source_postings")
              .upsert(upsertRow, { onConflict: "source,source_external_id" })
              .select("id")
              .single();
            if (spErr) throw new Error(`source_postings upsert: ${spErr.message}`);

            if (wasExpired) rowsReactivated++;
            rowsUpserted++;

            // Canonical
            const { data: existingCo } = await admin
              .from("canonical_opportunities")
              .select("id")
              .eq("identity_fingerprint", fp)
              .maybeSingle();

            let canonicalId: string;
            if (existingCo) {
              canonicalId = existingCo.id;
              await admin
                .from("canonical_opportunities")
                .update({
                  display_title: title,
                  display_company: company,
                  display_location: location,
                  display_url: safeUrl,
                  live_until: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", canonicalId);
            } else {
              const { data: coIns, error: coErr } = await admin
                .from("canonical_opportunities")
                .insert({
                  identity_fingerprint: fp,
                  display_title: title,
                  display_company: company,
                  display_location: location,
                  display_url: safeUrl,
                  primary_source: "careerjet",
                })
                .select("id")
                .single();
              if (coErr) throw new Error(`canonical insert: ${coErr.message}`);
              canonicalId = coIns.id;
            }

            // Link via helper RPC (primary/variant)
            const { error: linkErr } = await admin.rpc("link_canonical_to_source", {
              p_canonical: canonicalId,
              p_posting: spUp.id,
              p_merge_reason: "careerjet_sync",
            });
            if (linkErr) throw new Error(`link: ${linkErr.message}`);
          } catch (e: any) {
            rowsFailed++;
            dataIssues.push({ error: String(e?.message ?? e) });
          }
        }
      }
      // mark term as run
      if (!dryRun) {
        await admin
          .from("careerjet_search_terms")
          .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", t.id);
      }
    }
  } catch (e: any) {
    status = "failed";
    errorSummary = `system: ${String(e?.message ?? e)}`;
  }

  // Stale-expiry only on clean success
  let rowsExpired = 0;
  if (status === "success" && apiErrors.length === 0 && !dryRun) {
    const { data: expData } = await admin.rpc("mark_stale_careerjet_postings", { p_days: 7 });
    rowsExpired = Number(expData ?? 0);
  }

  await admin
    .from("careerjet_sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      cursor_term: lastTerm,
      cursor_page: lastPage,
      rows_fetched: rowsFetched,
      rows_upserted: rowsUpserted,
      rows_expired: rowsExpired,
      rows_reactivated: rowsReactivated,
      rows_failed: rowsFailed,
      terms_covered: termsCovered,
      api_errors: apiErrors,
      error_summary: errorSummary,
      meta: {
        terms_per_run: termsPerRun,
        pages_per_term: pagesPerTerm,
        dry_run: dryRun,
        prefix_counts: prefixCounts,
        data_issues: dataIssues.slice(0, 50),
        data_issues_count: dataIssues.length,
      },
    })
    .eq("id", runId);

  return json({
    ok: status !== "failed",
    run_id: runId,
    status,
    duration_ms: Date.now() - tStart,
    rows_fetched: rowsFetched,
    rows_upserted: rowsUpserted,
    rows_expired: rowsExpired,
    rows_reactivated: rowsReactivated,
    rows_failed: rowsFailed,
    terms_covered: termsCovered,
    api_errors_count: apiErrors.length,
    prefix_counts: prefixCounts,
  });
});
