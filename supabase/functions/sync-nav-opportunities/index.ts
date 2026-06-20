// M5.6 sync-nav-opportunities
// Henter NAV-annonser fra eksternt prosjekt og syncer inn i felles canonical-stack.
// Sletter ALDRI rader. INACTIVE bevarer historisk raw_payload.nav_detail.
// Auth: x-sync-nav-secret (konstant-tids sammenligning).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NAV_SOURCE_URL = Deno.env.get("NAV_SOURCE_SUPABASE_URL") ?? "";
const NAV_SOURCE_KEY = Deno.env.get("NAV_SOURCE_SERVICE_ROLE_KEY") ?? "";
const SYNC_NAV_SECRET = Deno.env.get("SYNC_NAV_SECRET") ?? "";
const AI_MODEL = Deno.env.get("NAV_SYNC_AI_MODEL") ?? "google/gemini-2.5-flash";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const BATCH_LIMIT = 200;
const STALE_LOCK_MINUTES = 60;
const AI_MAX_PER_RUN = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-nav-secret",
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

function fingerprint(company: string | null, title: string | null, location: string | null): string {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `fp1:${cryptoMd5(`cmp:${norm(company)}|${norm(title)}|${norm(location)}`)}`;
}

// Simple md5 polyfill via Web Crypto SHA-1 truncated would differ from DB.
// To match public.opportunity_fingerprint() exactly we instead call the DB helper.
function cryptoMd5(_s: string): string {
  // Placeholder: we'll call DB function for the canonical fingerprint instead.
  return "";
}

type NavRow = {
  external_id: string;
  status: "ACTIVE" | "INACTIVE" | string;
  title: string | null;
  employer: string | null;
  location: string | null;
  url: string | null;
  published_at: string | null;
  changed_at: string;
  nav_event_modified_at: string | null;
  date_modified: string | null;
  nav_detail: Record<string, unknown> | null;
  description_excerpt?: string | null;
};


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the public NAV display URL — never the feed-API URL (which 401s). */
function navDisplayUrl(externalId: string | null, navDetail: any, rawPayload: any): string | null {
  const candidates = [
    navDetail && typeof navDetail === "object" ? (navDetail as any).uuid : null,
    rawPayload && typeof rawPayload === "object" && (rawPayload as any).nav_detail
      ? (rawPayload as any).nav_detail.uuid : null,
    rawPayload && typeof rawPayload === "object" && (rawPayload as any)._feed_entry
      ? (rawPayload as any)._feed_entry.uuid : null,
    externalId && UUID_RE.test(externalId) ? externalId : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && UUID_RE.test(c)) {
      return `https://arbeidsplassen.nav.no/stillinger/stilling/${c}`;
    }
  }
  return null;
}

/** Normalize NAV extent → 'full_time' | 'part_time' | null. */
function normalizeWorkExtent(navDetail: any): string | null {
  if (!navDetail || typeof navDetail !== "object") return null;
  const ad = (navDetail as any).ad_content ?? null;
  const j = (navDetail as any).json ?? null;
  const raw = (ad && ad.extent) ?? (j && j.extent) ?? null;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "heltid") return "full_time";
  if (v === "deltid") return "part_time";
  return null;
}

/** Normalize NAV engagementtype → 'permanent' | 'temporary' | 'project' | 'interim' | null. */
function normalizeEngagementType(navDetail: any): string | null {
  if (!navDetail || typeof navDetail !== "object") return null;
  const ad = (navDetail as any).ad_content ?? null;
  const j = (navDetail as any).json ?? null;
  const raw = (ad && ad.engagementtype) ?? (j && j.engagementtype) ?? null;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "fast" || v === "faste stillinger") return "permanent";
  if (v === "vikariat" || v === "midlertidig" || v === "engasjement" || v === "sesong") return "temporary";
  if (v === "prosjekt" || v === "prosjektstilling" || v === "oppdrag") return "project";
  if (v === "interim") return "interim";
  // 'annet'/'ukjent'/other → null
  return null;
}

/** Select the most authoritative NAV upstream event timestamp for an INACTIVE event.
 *  Priority (per M5.8 lifecycle spec):
 *   1) incoming nav_event_modified_at
 *   2) incoming date_modified
 *   3) original NAV _feed_entry.sistEndret (preserved on the row)
 *   4) existing stored source_event_at on previous nav_inactive_event
 *   5) existing stored last_nav_changed_at
 *   6) now() as last-resort fallback
 *  We deliberately do NOT use incoming.changed_at / updated_at / last_seen_at as the first choice —
 *  those can reflect mirror import time, not upstream event time. */
function pickInactiveSourceEventAt(existing: any, incoming: NavRow): { iso: string; chosen_from: string } {
  const fromIncomingNavEvent = incoming.nav_event_modified_at ?? null;
  if (fromIncomingNavEvent) return { iso: fromIncomingNavEvent, chosen_from: "incoming.nav_event_modified_at" };
  const fromIncomingDateMod = incoming.date_modified ?? null;
  if (fromIncomingDateMod) return { iso: fromIncomingDateMod, chosen_from: "incoming.date_modified" };
  const detail = (existing && typeof existing === "object" && (existing as any).nav_detail) || incoming.nav_detail || null;
  const feedSistEndret =
    detail && typeof detail === "object"
      ? ((detail as any)?._feed_entry?.sistEndret ?? (detail as any)?.sistEndret ?? null)
      : null;
  if (typeof feedSistEndret === "string" && feedSistEndret) {
    return { iso: feedSistEndret, chosen_from: "nav_detail._feed_entry.sistEndret" };
  }
  const existingEvent = existing && typeof existing === "object" ? (existing as any).nav_inactive_event : null;
  const existingSourceEventAt =
    existingEvent && typeof existingEvent === "object" ? (existingEvent as any).source_event_at : null;
  if (typeof existingSourceEventAt === "string" && existingSourceEventAt) {
    return { iso: existingSourceEventAt, chosen_from: "existing.nav_inactive_event.source_event_at" };
  }
  const existingLastChanged = existing && typeof existing === "object" ? (existing as any).last_nav_changed_at : null;
  if (typeof existingLastChanged === "string" && existingLastChanged) {
    return { iso: existingLastChanged, chosen_from: "existing.last_nav_changed_at" };
  }
  return { iso: new Date().toISOString(), chosen_from: "now_fallback" };
}

function mergeNavPayload(
  existing: any,
  incoming: NavRow,
): { payload: Record<string, unknown>; sourceEventAt: string | null } {
  const base: Record<string, unknown> = { ...(existing && typeof existing === "object" ? existing : {}) };
  if (incoming.status === "ACTIVE") {
    const incomingDetail = incoming.nav_detail ?? null;
    if (incomingDetail) {
      if (base.nav_detail && JSON.stringify(base.nav_detail) !== JSON.stringify(incomingDetail)) {
        base.previous_nav_detail = base.nav_detail;
      }
      base.nav_detail = incomingDetail;
    }
    base.last_nav_status = "ACTIVE";
    base.last_nav_changed_at = incoming.changed_at;
    return { payload: base, sourceEventAt: null };
  }
  // INACTIVE: preserve existing nav_detail; never overwrite.
  if (!base.nav_detail && incoming.nav_detail) base.nav_detail = incoming.nav_detail;
  const { iso: sourceEventAt, chosen_from } = pickInactiveSourceEventAt(existing, incoming);
  base.nav_inactive_event = {
    at: incoming.changed_at,
    source_event_at: sourceEventAt,
    source_event_at_chosen_from: chosen_from,
    external_id: incoming.external_id,
  };
  base.last_nav_status = "INACTIVE";
  base.last_nav_changed_at = sourceEventAt;
  return { payload: base, sourceEventAt };
}


async function callAi(prompt: string): Promise<{ score: number; reasoning: string } | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: "Du vurderer jobbmatch på en skala 0-100. Svar kort JSON: {\"score\":N,\"reasoning\":\"...\"}" },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content ?? "";
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return { score, reasoning: String(parsed.reasoning ?? "").slice(0, 1000) };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  // ===== AUTH =====
  const provided = req.headers.get("x-sync-nav-secret") ?? "";
  if (!SYNC_NAV_SECRET || !provided || !timingSafeEqualStr(provided, SYNC_NAV_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing supabase env" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ===== Concurrency guard =====
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  const { data: inflight } = await admin
    .from("nav_sync_runs")
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

  // ===== Read cursor from last SUCCESSFUL finished run (BEFORE creating new row) =====
  const { data: lastDone } = await admin
    .from("nav_sync_runs")
    .select("id, meta")
    .not("finished_at", "is", null)
    .is("error_summary", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta0 = (lastDone?.meta as any) ?? {};
  let cursorChangedAt: string =
    typeof meta0.cursor_changed_at === "string"
      ? meta0.cursor_changed_at
      : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  let cursorExternalId: string =
    typeof meta0.cursor_external_id === "string" ? meta0.cursor_external_id : "";
  const prevRunId = lastDone?.id ?? null;

  // ===== Create new run row =====
  const { data: runRow, error: runErr } = await admin
    .from("nav_sync_runs")
    .insert({
      meta: {
        cursor_changed_at: cursorChangedAt,
        cursor_external_id: cursorExternalId,
        model: AI_MODEL,
        prev_run_id: prevRunId,
      },
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return json({ ok: false, error: `run insert failed: ${runErr?.message}` }, 500);
  }
  const runId = runRow.id;

  let fetched = 0;
  let upserted = 0;
  let expired = 0;
  let reactivated = 0;
  let matched_user_opps = 0;
  let scored = 0;
  const dataIssues: any[] = [];
  const systemErrors: any[] = [];
  const aiErrors: any[] = [];
  let errorSummary: string | null = null;

  try {
    if (!NAV_SOURCE_URL || !NAV_SOURCE_KEY) {
      errorSummary = "system_error: NAV_SOURCE env missing";
    } else {
      const navClient = createClient(NAV_SOURCE_URL, NAV_SOURCE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: navRows, error: navErr } = await navClient.rpc(
        "list_nav_opportunities_since",
        {
          p_since: cursorChangedAt,
          p_after_external_id: cursorExternalId,
          p_limit: BATCH_LIMIT,
        },
      );

      if (navErr) {
        errorSummary = `system_error: nav rpc failed: ${navErr.message}`;
      } else {
        const rawRows: any[] = (navRows ?? []) as any;
        // Normalize source row shape -> adapter NavRow shape.
        const rows: NavRow[] = rawRows.map((r) => {
          const rp = (r && typeof r.raw_payload === "object" && r.raw_payload) || {};
          const navDetail =
            (rp && typeof (rp as any).nav_detail === "object" && (rp as any).nav_detail) ||
            (r && typeof r.nav_detail === "object" && r.nav_detail) ||
            null;
          const navEventMod = r.nav_event_modified_at ?? null;
          const dateMod = r.date_modified ?? null;
          // changed_at is used ONLY as cursor progress timestamp (mirror-side ordering).
          const changedAt =
            r.changed_at ?? navEventMod ?? dateMod ?? r.updated_at ?? null;
          return {
            external_id: r.external_id,
            status: r.status,
            title: r.title ?? null,
            employer: r.employer ?? r.company_name ?? null,
            location: r.location ?? null,
            url: r.url ?? null,
            published_at: r.published_at ?? null,
            changed_at: changedAt,
            nav_event_modified_at: navEventMod,
            date_modified: dateMod,
            nav_detail: navDetail,
            description_excerpt: r.description_excerpt ?? null,
          } as NavRow;
        });

        fetched = rows.length;

        const newCanonicalIds: string[] = [];
        const touchedCanonicalIds: string[] = [];

        for (const row of rows) {
          try {
            if (!row.external_id || !row.title || !row.employer) {
              dataIssues.push({ external_id: row.external_id, reason: "missing required field" });
              cursorChangedAt = row.changed_at ?? cursorChangedAt;
              cursorExternalId = row.external_id ?? cursorExternalId;
              continue;
            }

            // Get DB-canonical fingerprint
            const { data: fpData, error: fpErr } = await admin.rpc("opportunity_fingerprint", {
              p_company: row.employer,
              p_title: row.title,
              p_location: row.location ?? "",
            });
            if (fpErr) throw new Error(`fingerprint: ${fpErr.message}`);
            const fp = String(fpData);

            // Fetch existing source_posting
            const { data: existingSp } = await admin
              .from("source_postings")
              .select("id, raw_payload, posting_status, work_extent, engagement_type")
              .eq("source", "nav")
              .eq("source_external_id", row.external_id)
              .maybeSingle();

            const merged = mergeNavPayload(existingSp?.raw_payload ?? null, row);
            const mergedPayload = merged.payload;
            const wasInactive = existingSp?.posting_status === "expired" || existingSp?.posting_status === "removed";
            const isActive = row.status === "ACTIVE";

            // Build public arbeidsplassen URL — never the feed-API URL (which 401s).
            const safeUrl =
              navDisplayUrl(row.external_id, row.nav_detail, mergedPayload) ??
              (row.external_id && UUID_RE.test(row.external_id)
                ? `https://arbeidsplassen.nav.no/stillinger/stilling/${row.external_id}`
                : null);

            // Normalized work_extent / engagement_type.
            // INACTIVE: NEVER null out previously-stored values; preserve them.
            const newExtent = normalizeWorkExtent(row.nav_detail);
            const newEngage = normalizeEngagementType(row.nav_detail);
            const finalExtent = isActive
              ? (newExtent ?? existingSp?.work_extent ?? null)
              : (existingSp?.work_extent ?? newExtent ?? null);
            const finalEngage = isActive
              ? (newEngage ?? existingSp?.engagement_type ?? null)
              : (existingSp?.engagement_type ?? newEngage ?? null);

            // Lifecycle invariants:
            //  ACTIVE       → posting_status='active', expired_at=NULL (clears on reactivation), reactivated_at set.
            //  INACTIVE     → posting_status='expired',
            //                 expired_at = LEAST(sourceEventAt, now()),
            //                 last_seen_at = now() (mirror sync time, not upstream event time).
            const nowIso = new Date().toISOString();
            const spUpsert: any = {
              source: "nav",
              source_external_id: row.external_id,
              raw_url: safeUrl,
              display_url: safeUrl,
              title: row.title,
              company: row.employer,
              location: row.location ?? null,
              description_excerpt: row.description_excerpt ?? null,
              raw_payload: mergedPayload,
              identity_fingerprint: fp,
              published_at: row.published_at,
              last_seen_at: nowIso,
              posting_status: isActive ? "active" : "expired",
              work_extent: finalExtent,
              engagement_type: finalEngage,
              updated_at: nowIso,
            };
            if (isActive) {
              spUpsert.expired_at = null;
              if (wasInactive) spUpsert.reactivated_at = nowIso;
            } else {
              const candidateMs = merged.sourceEventAt ? Date.parse(merged.sourceEventAt) : NaN;
              const nowMs = Date.parse(nowIso);
              const expiredIso = Number.isFinite(candidateMs)
                ? new Date(Math.min(candidateMs, nowMs)).toISOString()
                : nowIso;
              // Preserve a correct historical expired_at when already set and earlier than candidate.
              const existingExpired = (existingSp as any)?.expired_at as string | null | undefined;
              if (!existingExpired) {
                spUpsert.expired_at = expiredIso;
              } else {
                const existingMs = Date.parse(existingExpired);
                spUpsert.expired_at =
                  Number.isFinite(existingMs) && existingMs < Date.parse(expiredIso)
                    ? existingExpired
                    : expiredIso;
              }
            }


            const { data: spUp, error: spErr } = await admin
              .from("source_postings")
              .upsert(spUpsert, { onConflict: "source,source_external_id" })
              .select("id")
              .single();
            if (spErr) throw new Error(`source_postings upsert: ${spErr.message}`);

            if (isActive && wasInactive) reactivated++;
            upserted++;

            // Canonical opportunity upsert by fingerprint
            const { data: existingCo } = await admin
              .from("canonical_opportunities")
              .select("id, live_until, primary_source")
              .eq("identity_fingerprint", fp)
              .maybeSingle();

            let canonicalId: string;
            if (existingCo) {
              canonicalId = existingCo.id;
              const upd: any = { updated_at: new Date().toISOString() };
              if (isActive) {
                upd.live_until = null;
                upd.display_title = row.title;
                upd.display_company = row.employer;
                upd.display_location = row.location ?? null;
                upd.display_url = safeUrl;
              }
              await admin.from("canonical_opportunities").update(upd).eq("id", canonicalId);
              if (isActive) touchedCanonicalIds.push(canonicalId);
            } else {
              const { data: coIns, error: coErr } = await admin
                .from("canonical_opportunities")
                .insert({
                  identity_fingerprint: fp,
                  display_title: row.title,
                  display_company: row.employer,
                  display_location: row.location ?? null,
                  display_url: safeUrl,
                  primary_source: "nav",
                })
                .select("id")
                .single();
              if (coErr) throw new Error(`canonical insert: ${coErr.message}`);
              canonicalId = coIns.id;
              newCanonicalIds.push(canonicalId);
              if (isActive) touchedCanonicalIds.push(canonicalId);
            }

            // Link
            await admin
              .from("opportunity_source_links")
              .upsert(
                {
                  canonical_opportunity_id: canonicalId,
                  source_posting_id: spUp.id,
                  link_role: existingCo ? "variant" : "primary",
                  merge_reason: "nav_sync",
                },
                { onConflict: "canonical_opportunity_id,source_posting_id" },
              );

            // For INACTIVE: compute live_until if all linked source_postings are expired
            if (!isActive) {
              const { data: linkedSp } = await admin
                .from("opportunity_source_links")
                .select("source_postings!inner(posting_status, expired_at)")
                .eq("canonical_opportunity_id", canonicalId);
              const all = (linkedSp ?? []) as any[];
              const allExpired =
                all.length > 0 &&
                all.every((l) => {
                  const sp = (l as any).source_postings;
                  return sp && (sp.posting_status === "expired" || sp.posting_status === "removed");
                });
              if (allExpired) {
                const maxExpired = all
                  .map((l) => (l as any).source_postings?.expired_at)
                  .filter(Boolean)
                  .sort()
                  .pop();
                const base = maxExpired ? new Date(maxExpired) : new Date();
                const liveUntil = new Date(base.getTime() + 7 * 24 * 3600 * 1000).toISOString();
                await admin
                  .from("canonical_opportunities")
                  .update({ live_until: liveUntil, updated_at: new Date().toISOString() })
                  .eq("id", canonicalId);
                expired++;
              }
            }

            // Advance cursor only on full success
            cursorChangedAt = row.changed_at ?? cursorChangedAt;
            cursorExternalId = row.external_id;
          } catch (e: any) {
            systemErrors.push({ external_id: row.external_id, error: String(e?.message ?? e) });
            errorSummary = `system_error: ${String(e?.message ?? e)}`;
            break; // stop, keep cursor at last successful row
          }
        }

        // Per-user matching (ACTIVE canonical only). Only when no system error.
        const matchCandidateIds = Array.from(new Set(touchedCanonicalIds));
        if (!errorSummary && matchCandidateIds.length > 0) {
          // Fetch active canonical with their NAV source posting
          const { data: activeCanon } = await admin
            .from("canonical_opportunities")
            .select("id, identity_fingerprint, display_title, display_company, display_location, display_url, live_until")
            .in("id", matchCandidateIds)
            .is("live_until", null);

          const { data: profiles } = await admin
            .from("profiles")
            .select("id, job_search_keywords, preferred_locations");

          // Parse profile keywords: tolerate text or array, split on , ; newline
          const parsedProfiles = (profiles ?? []).map((p: any) => {
            const rawKw = p.job_search_keywords;
            const kws: string[] = Array.isArray(rawKw)
              ? rawKw.map((k) => String(k))
              : typeof rawKw === "string"
                ? rawKw.split(/[,;\n]+/)
                : [];
            const locs: string[] = Array.isArray(p.preferred_locations)
              ? p.preferred_locations.map((l: any) => String(l))
              : [];
            return {
              id: p.id as string,
              kws: kws.map((k) => k.trim().toLowerCase()).filter(Boolean),
              locs: locs.map((l) => l.trim().toLowerCase()).filter(Boolean),
            };
          });

          const usersToScore: { userId: string; canonicalId: string; co: any }[] = [];

          for (const co of activeCanon ?? []) {
            const titleLc = (co.display_title ?? "").toLowerCase();
            const locLc = (co.display_location ?? "").toLowerCase();
            for (const p of parsedProfiles) {
              const kwMatch = p.kws.length === 0 ? false : p.kws.some((k) => titleLc.includes(k));
              const locMatch = p.locs.length === 0 ? true : p.locs.some((l) => locLc.includes(l));
              if (!kwMatch || !locMatch) continue;

              // Skip if user already has this canonical (avoid unique-violation noise)
              const { data: existingUo } = await admin
                .from("user_opportunities")
                .select("id")
                .eq("user_id", p.id)
                .eq("canonical_opportunity_id", co.id)
                .maybeSingle();
              if (existingUo) continue;

              const ins = await admin
                .from("user_opportunities")
                .insert({
                  user_id: p.id,
                  canonical_opportunity_id: co.id,
                  identity_fingerprint: (co as any).identity_fingerprint ?? "",
                  status: "new",
                  card_title: co.display_title,
                  card_company: co.display_company,
                  card_location: co.display_location,
                  card_display_url: co.display_url,
                  card_raw_url: co.display_url,
                  card_source: "nav",
                })
                .select("id")
                .maybeSingle();
              if (ins.data) {
                matched_user_opps++;
                usersToScore.push({ userId: p.id, canonicalId: co.id, co });
              }
            }
          }

          // AI scoring (best-effort, capped)
          if (LOVABLE_API_KEY) {
            for (const item of usersToScore.slice(0, AI_MAX_PER_RUN)) {
              try {
                const ai = await callAi(
                  `Stilling: ${item.co.display_title} hos ${item.co.display_company} i ${item.co.display_location ?? ""}. Vurder match 0-100.`,
                );
                if (ai) {
                  await admin
                    .from("user_opportunities")
                    .update({
                      ai_score: ai.score,
                      ai_reasoning: ai.reasoning,
                      ai_scored_at: new Date().toISOString(),
                    })
                    .eq("user_id", item.userId)
                    .eq("canonical_opportunity_id", item.canonicalId);
                  scored++;
                }
              } catch (e: any) {
                aiErrors.push({ canonicalId: item.canonicalId, error: String(e?.message ?? e) });
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    errorSummary = `system_error: ${String(e?.message ?? e)}`;
    systemErrors.push({ error: String(e?.message ?? e) });
  }

  // Finalize run
  await admin
    .from("nav_sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      fetched,
      upserted,
      expired,
      reactivated,
      matched_user_opps,
      scored,
      error_summary: errorSummary,
      meta: {
        cursor_changed_at: cursorChangedAt,
        cursor_external_id: cursorExternalId,
        model: AI_MODEL,
        prev_run_id: prevRunId,
        dataIssues,
        systemErrors,
        aiErrors,
      },
    })
    .eq("id", runId);

  return json({
    ok: errorSummary == null,
    run_id: runId,
    fetched,
    upserted,
    expired,
    reactivated,
    matched_user_opps,
    scored,
    error_summary: errorSummary,
  });
});
