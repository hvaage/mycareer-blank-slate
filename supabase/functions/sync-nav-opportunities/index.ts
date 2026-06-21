// NAV target sync (Lovable target).
// Reads frozen upstream RPCs (norwegian-career-intelligence v1):
//   - list_nav_opportunities_since(p_since, p_after_external_id, p_limit)
//   - list_nav_opportunities_by_external_ids(p_ids)
// Implements conditional-merge invariants on source_event_version + source_payload_hash:
//   - incoming.version < stored.version           → STALE, skip (no target write)
//   - same version AND same hash                  → NO-OP, skip (no updated_at bump)
//   - else                                        → MERGE (preserve rich nav_detail on sparse/INACTIVE)
// NEVER deletes rows or raw_payload history. INACTIVE preserves nav_detail and AI fields.
// Auth: x-sync-nav-secret (constant-time compare).
//
// Body params:
//   { mode?: "cursor" | "repair_by_ids",
//     repair_batch_size?: number,    // 1..500, default 200
//     max_batches?: number,           // default 1, hard ceiling 10
//     repair_run_id?: string          // resume an existing repair run
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NAV_SOURCE_URL = Deno.env.get("NAV_SOURCE_SUPABASE_URL") ?? "";
const NAV_SOURCE_KEY = Deno.env.get("NAV_SOURCE_SERVICE_ROLE_KEY") ?? "";
const SYNC_NAV_SECRET = Deno.env.get("SYNC_NAV_SECRET") ?? "";
const AI_MODEL = Deno.env.get("NAV_SYNC_AI_MODEL") ?? "google/gemini-2.5-flash";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const CURSOR_BATCH_LIMIT = 200;
const REPAIR_BATCH_DEFAULT = 200;
const REPAIR_BATCH_MAX = 500;       // upstream RPC hard limit
const REPAIR_BATCHES_MAX = 10;
const STALE_LOCK_MINUTES = 60;
const AI_MAX_PER_RUN = 20;
const LEASE_NAME = "nav_target_writer";
const LEASE_TTL_SECONDS = 180;

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

// --- Global target writer lease helpers ---
async function claimLease(admin: any, runId: string, mode: string)
  : Promise<{ ok: boolean; owner_run_id?: string; owner_mode?: string; expires_at?: string }> {
  const { data, error } = await admin.rpc("nav_target_lease_claim", {
    p_lease_name: LEASE_NAME, p_run_id: runId, p_mode: mode, p_ttl_seconds: LEASE_TTL_SECONDS,
  });
  if (error) return { ok: false };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false };
  return {
    ok: Boolean(row.claimed),
    owner_run_id: row.current_run_id ?? undefined,
    owner_mode: row.current_mode ?? undefined,
    expires_at: row.expires_at ?? undefined,
  };
}
async function heartbeatLease(admin: any, runId: string): Promise<void> {
  try { await admin.rpc("nav_target_lease_heartbeat", {
    p_lease_name: LEASE_NAME, p_run_id: runId, p_ttl_seconds: LEASE_TTL_SECONDS,
  }); } catch { /* noop */ }
}
async function releaseLease(admin: any, runId: string): Promise<void> {
  try { await admin.rpc("nav_target_lease_release", {
    p_lease_name: LEASE_NAME, p_run_id: runId,
  }); } catch { /* noop */ }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UpstreamRow = {
  external_id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  url: string | null;
  published_at: string | null;
  expires_at: string | null;
  application_due: string | null; // DATE in upstream; treat as string
  status: string;                  // "ACTIVE" | "INACTIVE"
  date_modified: string | null;
  nav_event_modified_at: string | null;
  updated_at?: string | null;      // cursor-RPC only (mirror updated_at)
  raw_payload: Record<string, unknown> | null;
  source_event_version: string | null;
  source_payload_hash: string | null;
  source_event_id: string | null;
  changed_at?: string | null;      // cursor-RPC only (tuple cursor)
};

/** Build the public arbeidsplassen URL — never the feed-API URL (which 401s). */
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
  return null;
}

/** Reliable upstream NAV event-time sources (used for grace eligibility). */
const RELIABLE_CHOSEN_FROM = new Set([
  "incoming.source_event_version",
  "incoming.nav_event_modified_at",
  "incoming.date_modified",
  "nav_detail._feed_entry.sistEndret",
  "nav_detail.sistEndret",
  "nav_detail.ad_content.updated",
  "nav_detail.json.updated",
]);

function pickInactiveSourceEventAt(
  existing: any,
  incoming: UpstreamRow,
): { iso: string; chosen_from: string; reliable: boolean } {
  // Upstream's source_event_version is the canonical event time — prefer it first.
  if (incoming.source_event_version) {
    return {
      iso: incoming.source_event_version,
      chosen_from: "incoming.source_event_version",
      reliable: true,
    };
  }
  if (incoming.nav_event_modified_at) {
    return {
      iso: incoming.nav_event_modified_at,
      chosen_from: "incoming.nav_event_modified_at",
      reliable: true,
    };
  }
  if (incoming.date_modified) {
    return { iso: incoming.date_modified, chosen_from: "incoming.date_modified", reliable: true };
  }
  const detail =
    (incoming.raw_payload && typeof incoming.raw_payload === "object" && (incoming.raw_payload as any).nav_detail) ||
    (existing && typeof existing === "object" && (existing as any).nav_detail) ||
    null;
  const feedSE = detail && typeof detail === "object"
    ? (detail as any)?._feed_entry?.sistEndret ?? null : null;
  if (typeof feedSE === "string" && feedSE) {
    return { iso: feedSE, chosen_from: "nav_detail._feed_entry.sistEndret", reliable: true };
  }
  const detailSE = detail && typeof detail === "object" ? (detail as any)?.sistEndret ?? null : null;
  if (typeof detailSE === "string" && detailSE) {
    return { iso: detailSE, chosen_from: "nav_detail.sistEndret", reliable: true };
  }
  const adU = detail && typeof detail === "object" ? (detail as any)?.ad_content?.updated ?? null : null;
  if (typeof adU === "string" && adU) {
    return { iso: adU, chosen_from: "nav_detail.ad_content.updated", reliable: true };
  }
  const jU = detail && typeof detail === "object" ? (detail as any)?.json?.updated ?? null : null;
  if (typeof jU === "string" && jU) {
    return { iso: jU, chosen_from: "nav_detail.json.updated", reliable: true };
  }
  const existingEvent =
    existing && typeof existing === "object" ? (existing as any).nav_inactive_event : null;
  const existingSourceEventAt =
    existingEvent && typeof existingEvent === "object"
      ? (existingEvent as any).source_event_at
      : null;
  const existingChosenFrom =
    existingEvent && typeof existingEvent === "object"
      ? (existingEvent as any).source_event_at_chosen_from
      : null;
  if (
    typeof existingSourceEventAt === "string" &&
    existingSourceEventAt &&
    typeof existingChosenFrom === "string" &&
    RELIABLE_CHOSEN_FROM.has(existingChosenFrom)
  ) {
    return {
      iso: existingSourceEventAt,
      chosen_from: `existing.nav_inactive_event(${existingChosenFrom})`,
      reliable: true,
    };
  }
  return { iso: new Date().toISOString(), chosen_from: "now_fallback", reliable: false };
}

function mergeNavPayload(existing: any, incoming: UpstreamRow): {
  payload: Record<string, unknown>;
  sourceEventAt: string | null;
  reliable: boolean;
  hadPriorActiveOrDetail: boolean;
} {
  const base: Record<string, unknown> = { ...(existing && typeof existing === "object" ? existing : {}) };
  const incomingRaw = (incoming.raw_payload && typeof incoming.raw_payload === "object")
    ? (incoming.raw_payload as any) : {};
  const incomingDetail = (incomingRaw.nav_detail && typeof incomingRaw.nav_detail === "object")
    ? incomingRaw.nav_detail : null;

  // Copy upstream raw_payload top-level scalar fields into base (without dropping rich nav_detail).
  // We treat upstream raw_payload as the source of truth for everything EXCEPT nav_detail
  // (which is preserved when incoming is sparse).
  for (const [k, v] of Object.entries(incomingRaw)) {
    if (k === "nav_detail") continue;
    if (v !== null && v !== undefined) (base as any)[k] = v;
  }

  const hadPriorActiveOrDetail =
    !!(base as any).nav_detail ||
    (typeof (base as any).last_nav_status === "string" && (base as any).last_nav_status === "ACTIVE");

  const isActive = incoming.status === "ACTIVE";

  if (isActive) {
    if (incomingDetail) {
      if ((base as any).nav_detail
          && JSON.stringify((base as any).nav_detail) !== JSON.stringify(incomingDetail)) {
        (base as any).previous_nav_detail = (base as any).nav_detail;
      }
      (base as any).nav_detail = incomingDetail;
    }
    (base as any).last_nav_status = "ACTIVE";
    (base as any).last_nav_changed_at = incoming.source_event_version
      ?? incoming.nav_event_modified_at ?? incoming.date_modified ?? incoming.changed_at
      ?? new Date().toISOString();
    return { payload: base, sourceEventAt: null, reliable: true, hadPriorActiveOrDetail };
  }

  // INACTIVE: never overwrite existing rich nav_detail with sparse data.
  if (!(base as any).nav_detail && incomingDetail) (base as any).nav_detail = incomingDetail;
  const picked = pickInactiveSourceEventAt(existing, incoming);
  const graceEligible = picked.reliable || hadPriorActiveOrDetail;
  (base as any).nav_inactive_event = {
    at: incoming.changed_at ?? new Date().toISOString(),
    source_event_at: picked.iso,
    source_event_at_chosen_from: picked.chosen_from,
    source_event_at_reliable: picked.reliable,
    grace_eligible: graceEligible,
    external_id: incoming.external_id,
  };
  (base as any).last_nav_status = "INACTIVE";
  (base as any).last_nav_changed_at = picked.iso;
  return { payload: base, sourceEventAt: picked.iso, reliable: picked.reliable, hadPriorActiveOrDetail };
}

/**
 * Apply conditional-merge predicate. Returns the action to take.
 * - "stale": incoming.source_event_version < stored.source_event_version → no write
 * - "noop":  same version AND same hash → no write
 * - "apply": newer event, or same version with different hash (richer payload), or first-time → write
 */
function classifyMerge(
  stored: { source_event_version: string | null; source_payload_hash: string | null },
  incoming: { source_event_version: string | null; source_payload_hash: string | null },
): "stale" | "noop" | "apply" {
  const sv = stored.source_event_version;
  const sh = stored.source_payload_hash;
  const iv = incoming.source_event_version;
  const ih = incoming.source_payload_hash;
  if (!sv || !iv) return "apply"; // first-time / missing → always apply
  const svT = Date.parse(sv);
  const ivT = Date.parse(iv);
  if (Number.isFinite(svT) && Number.isFinite(ivT)) {
    if (ivT < svT) return "stale";
    if (ivT === svT && sh && ih && sh === ih) return "noop";
  }
  return "apply";
}

type RowOutcome = "insert" | "merge" | "noop" | "stale" | "data_issue" | "failed";

async function processRow(
  admin: any,
  row: UpstreamRow,
): Promise<{
  outcome: RowOutcome;
  spId?: string;
  canonicalId?: string;
  wasInactive?: boolean;
  isActive?: boolean;
  reliable?: boolean;
  hadPriorActiveOrDetail?: boolean;
  error?: string;
  reason?: string;
}> {
  try {
    const title = row.title;
    const company = row.company_name;
    if (!row.external_id || !title || !company) {
      return { outcome: "data_issue", reason: "missing required field" };
    }

    // Fetch existing
    const { data: existingSp } = await admin
      .from("source_postings")
      .select("id, raw_payload, posting_status, work_extent, engagement_type, source_event_version, source_payload_hash, expired_at")
      .eq("source", "nav")
      .eq("source_external_id", row.external_id)
      .maybeSingle();

    const decision = classifyMerge(
      {
        source_event_version: existingSp?.source_event_version ?? null,
        source_payload_hash: existingSp?.source_payload_hash ?? null,
      },
      {
        source_event_version: row.source_event_version,
        source_payload_hash: row.source_payload_hash,
      },
    );
    if (decision === "stale") return { outcome: "stale" };
    if (decision === "noop") return { outcome: "noop" };

    // Canonical fingerprint
    const { data: fpData, error: fpErr } = await admin.rpc("opportunity_fingerprint", {
      p_company: company, p_title: title, p_location: row.location ?? "",
    });
    if (fpErr) throw new Error(`fingerprint: ${fpErr.message}`);
    const fp = String(fpData);

    const merged = mergeNavPayload(existingSp?.raw_payload ?? null, row);
    const mergedPayload = merged.payload;
    const isActive = row.status === "ACTIVE";
    const wasInactive = existingSp?.posting_status === "expired" || existingSp?.posting_status === "removed";

    const safeUrl =
      navDisplayUrl(row.external_id, (mergedPayload as any).nav_detail, mergedPayload) ??
      (row.external_id && UUID_RE.test(row.external_id)
        ? `https://arbeidsplassen.nav.no/stillinger/stilling/${row.external_id}`
        : null);

    const newExtent = normalizeWorkExtent((mergedPayload as any).nav_detail);
    const newEngage = normalizeEngagementType((mergedPayload as any).nav_detail);
    // INACTIVE/sparse: never null out existing structured values.
    const finalExtent = isActive
      ? (newExtent ?? existingSp?.work_extent ?? null)
      : (existingSp?.work_extent ?? newExtent ?? null);
    const finalEngage = isActive
      ? (newEngage ?? existingSp?.engagement_type ?? null)
      : (existingSp?.engagement_type ?? newEngage ?? null);

    const nowIso = new Date().toISOString();
    const spUpsert: any = {
      source: "nav",
      source_external_id: row.external_id,
      raw_url: safeUrl,
      display_url: safeUrl,
      title,
      company,
      location: row.location ?? null,
      raw_payload: mergedPayload,
      identity_fingerprint: fp,
      published_at: row.published_at,
      last_seen_at: nowIso,
      posting_status: isActive ? "active" : "expired",
      work_extent: finalExtent,
      engagement_type: finalEngage,
      source_event_version: row.source_event_version ?? existingSp?.source_event_version ?? null,
      source_payload_hash: row.source_payload_hash ?? existingSp?.source_payload_hash ?? null,
      source_event_id: row.source_event_id ?? null,
      updated_at: nowIso,
    };

    if (isActive) {
      spUpsert.expired_at = null;
      if (wasInactive) spUpsert.reactivated_at = nowIso;
    } else {
      const existingExpired = (existingSp as any)?.expired_at as string | null | undefined;
      const observedTransition = merged.hadPriorActiveOrDetail;
      if (merged.reliable) {
        const candidateMs = Date.parse(merged.sourceEventAt ?? "");
        const nowMs = Date.parse(nowIso);
        const expiredIso = Number.isFinite(candidateMs)
          ? new Date(Math.min(candidateMs, nowMs)).toISOString()
          : nowIso;
        if (!existingExpired) {
          spUpsert.expired_at = expiredIso;
        } else {
          const existingMs = Date.parse(existingExpired);
          spUpsert.expired_at =
            Number.isFinite(existingMs) && existingMs < Date.parse(expiredIso)
              ? existingExpired
              : expiredIso;
        }
      } else if (observedTransition) {
        spUpsert.expired_at = existingExpired ?? nowIso;
      } else {
        // First-time INACTIVE without reliable upstream time AND no prior ACTIVE/detail:
        // do NOT fabricate expiry.
        spUpsert.expired_at = existingExpired ?? null;
      }
    }

    const { data: spUp, error: spErr } = await admin
      .from("source_postings")
      .upsert(spUpsert, { onConflict: "source,source_external_id" })
      .select("id")
      .single();
    if (spErr) throw new Error(`source_postings upsert: ${spErr.message}`);

    // Canonical
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
        upd.display_title = title;
        upd.display_company = company;
        upd.display_location = row.location ?? null;
        upd.display_url = safeUrl;
      }
      await admin.from("canonical_opportunities").update(upd).eq("id", canonicalId);
    } else {
      const { data: coIns, error: coErr } = await admin
        .from("canonical_opportunities")
        .insert({
          identity_fingerprint: fp,
          display_title: title,
          display_company: company,
          display_location: row.location ?? null,
          display_url: safeUrl,
          primary_source: "nav",
        })
        .select("id").single();
      if (coErr) throw new Error(`canonical insert: ${coErr.message}`);
      canonicalId = coIns.id;
    }

    await admin.from("opportunity_source_links").upsert(
      {
        canonical_opportunity_id: canonicalId,
        source_posting_id: spUp.id,
        link_role: existingCo ? "variant" : "primary",
        merge_reason: "nav_sync",
      },
      { onConflict: "canonical_opportunity_id,source_posting_id" },
    );

    // INACTIVE: compute live_until across linked source postings.
    if (!isActive) {
      const { data: linkedSp } = await admin
        .from("opportunity_source_links")
        .select("source_postings!inner(posting_status, expired_at)")
        .eq("canonical_opportunity_id", canonicalId);
      const all = (linkedSp ?? []) as any[];
      const allExpired = all.length > 0 && all.every((l) => {
        const sp = (l as any).source_postings;
        return sp && (sp.posting_status === "expired" || sp.posting_status === "removed");
      });
      if (allExpired) {
        const graceEligible = merged.reliable || merged.hadPriorActiveOrDetail;
        let liveUntil: string;
        if (graceEligible) {
          const maxExpired = all
            .map((l) => (l as any).source_postings?.expired_at)
            .filter(Boolean).sort().pop();
          const baseDt = maxExpired ? new Date(maxExpired) : new Date();
          liveUntil = new Date(baseDt.getTime() + 7 * 24 * 3600 * 1000).toISOString();
        } else {
          liveUntil = new Date().toISOString();
        }
        await admin.from("canonical_opportunities")
          .update({ live_until: liveUntil, updated_at: new Date().toISOString() })
          .eq("id", canonicalId);
      }
    }

    return {
      outcome: existingSp ? "merge" : "insert",
      spId: spUp.id,
      canonicalId,
      wasInactive,
      isActive,
      reliable: merged.reliable,
      hadPriorActiveOrDetail: merged.hadPriorActiveOrDetail,
    };
  } catch (e: any) {
    return { outcome: "failed", error: String(e?.message ?? e) };
  }
}

async function callAi(prompt: string): Promise<{ score: number; reasoning: string } | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
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

/** Match newly active canonicals to user profiles; only score those within ACTIVE/grace. */
async function runMatching(
  admin: any,
  touchedCanonicalIds: string[],
): Promise<{ matched_user_opps: number; scored: number; aiErrors: any[] }> {
  let matched_user_opps = 0;
  let scored = 0;
  const aiErrors: any[] = [];
  const ids = Array.from(new Set(touchedCanonicalIds));
  if (ids.length === 0) return { matched_user_opps, scored, aiErrors };

  const nowIso = new Date().toISOString();
  // Visibility predicate: EXISTS active linked source_posting OR live_until > now().
  // NOTE: live_until IS NULL alone is NOT visibility.
  const { data: futureCanon } = await admin
    .from("canonical_opportunities")
    .select("id")
    .in("id", ids)
    .gt("live_until", nowIso);
  const { data: linkRows } = await admin
    .from("opportunity_source_links")
    .select("canonical_opportunity_id, source_postings!inner(posting_status)")
    .in("canonical_opportunity_id", ids)
    .eq("source_postings.posting_status", "active");
  const eligibleIds = new Set<string>([
    ...((futureCanon ?? []).map((c: any) => c.id as string)),
    ...((linkRows ?? []).map((r: any) => r.canonical_opportunity_id as string)),
  ]);
  if (eligibleIds.size === 0) return { matched_user_opps, scored, aiErrors };
  const { data: activeCanon } = await admin
    .from("canonical_opportunities")
    .select("id, identity_fingerprint, display_title, display_company, display_location, display_url, live_until")
    .in("id", Array.from(eligibleIds));

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, job_search_keywords, preferred_locations");

  const parsedProfiles = (profiles ?? []).map((p: any) => {
    const rawKw = p.job_search_keywords;
    const kws: string[] = Array.isArray(rawKw)
      ? rawKw.map((k: any) => String(k))
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
      const { data: existingUo } = await admin
        .from("user_opportunities")
        .select("id")
        .eq("user_id", p.id)
        .eq("canonical_opportunity_id", co.id)
        .maybeSingle();
      if (existingUo) continue;
      const ins = await admin.from("user_opportunities").insert({
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
      }).select("id").maybeSingle();
      if (ins.data) {
        matched_user_opps++;
        usersToScore.push({ userId: p.id, canonicalId: co.id, co });
      }
    }
  }

  if (LOVABLE_API_KEY) {
    for (const item of usersToScore.slice(0, AI_MAX_PER_RUN)) {
      try {
        const ai = await callAi(
          `Stilling: ${item.co.display_title} hos ${item.co.display_company} i ${item.co.display_location ?? ""}. Vurder match 0-100.`,
        );
        if (ai) {
          await admin.from("user_opportunities").update({
            ai_score: ai.score, ai_reasoning: ai.reasoning, ai_scored_at: new Date().toISOString(),
          }).eq("user_id", item.userId).eq("canonical_opportunity_id", item.canonicalId);
          scored++;
        }
      } catch (e: any) {
        aiErrors.push({ canonicalId: item.canonicalId, error: String(e?.message ?? e) });
      }
    }
  }
  return { matched_user_opps, scored, aiErrors };
}

// ------- CURSOR MODE -------
async function runCursorMode(admin: any, navClient: any, prevMeta: any): Promise<any> {
  let cursorChangedAt: string = typeof prevMeta.cursor_changed_at === "string"
    ? prevMeta.cursor_changed_at
    : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  let cursorExternalId: string = typeof prevMeta.cursor_external_id === "string"
    ? prevMeta.cursor_external_id : "";

  const { data: navRows, error: navErr } = await navClient.rpc(
    "list_nav_opportunities_since",
    { p_since: cursorChangedAt, p_after_external_id: cursorExternalId, p_limit: CURSOR_BATCH_LIMIT },
  );
  if (navErr) {
    return { errorSummary: `system_error: nav rpc failed: ${navErr.message}`,
      fetched: 0, upserted: 0, expired: 0, reactivated: 0, noop: 0, stale: 0, dataIssues: [], systemErrors: [],
      cursorChangedAt, cursorExternalId, touchedCanonicalIds: [] };
  }
  const rows = (navRows ?? []) as UpstreamRow[];
  const fetched = rows.length;
  let upserted = 0, expired = 0, reactivated = 0, noopCount = 0, staleCount = 0;
  const dataIssues: any[] = [];
  const systemErrors: any[] = [];
  const touchedCanonicalIds: string[] = [];

  for (const row of rows) {
    const r = await processRow(admin, row);
    if (r.outcome === "data_issue") {
      dataIssues.push({ external_id: row.external_id, reason: r.reason });
    } else if (r.outcome === "failed") {
      systemErrors.push({ external_id: row.external_id, error: r.error });
      // Stop cursor advancement on system error.
      return { errorSummary: `system_error: ${r.error}`, fetched, upserted, expired, reactivated,
        noop: noopCount, stale: staleCount, dataIssues, systemErrors, cursorChangedAt, cursorExternalId, touchedCanonicalIds };
    } else if (r.outcome === "noop") {
      noopCount++;
    } else if (r.outcome === "stale") {
      staleCount++;
    } else {
      upserted++;
      if (r.isActive && r.wasInactive) reactivated++;
      if (!r.isActive) expired++;
      if (r.isActive && r.canonicalId) touchedCanonicalIds.push(r.canonicalId);
    }
    // Advance cursor for every successful classification (incl. noop/stale).
    if (row.changed_at) cursorChangedAt = row.changed_at;
    cursorExternalId = row.external_id;
  }

  return { errorSummary: null, fetched, upserted, expired, reactivated,
    noop: noopCount, stale: staleCount, dataIssues, systemErrors,
    cursorChangedAt, cursorExternalId, touchedCanonicalIds };
}

// ------- REPAIR-BY-IDS MODE -------
async function runRepairMode(
  admin: any, navClient: any,
  opts: { repair_batch_size: number; max_batches: number; repair_run_id: string | null },
): Promise<any> {
  // Open or resume run
  let repairRun: any;
  if (opts.repair_run_id) {
    const { data } = await admin.from("nav_repair_runs").select("*").eq("id", opts.repair_run_id).maybeSingle();
    if (!data) return { errorSummary: `system_error: repair run not found: ${opts.repair_run_id}` };
    if (data.status !== "running") {
      return { errorSummary: `system_error: repair run not running (status=${data.status})`, repair_run_id: data.id };
    }
    repairRun = data;
  } else {
    // Auto-resume the latest 'running' run, otherwise open a new one.
    const { data: existing } = await admin
      .from("nav_repair_runs")
      .select("*")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      repairRun = existing;
    } else {
      const { count: total } = await admin
        .from("source_postings").select("id", { count: "exact", head: true }).eq("source", "nav");
      const { data, error } = await admin.from("nav_repair_runs").insert({
        status: "running",
        cursor_after_external_id: "",
        total_target_rows: total ?? 0,
        meta: { batch_size: opts.repair_batch_size },
      }).select("*").single();
      if (error) return { errorSummary: `system_error: repair run insert: ${error.message}` };
      repairRun = data;
    }
  }

  let cursorAfter: string = repairRun.cursor_after_external_id ?? "";
  let batches = 0;
  let totalRequested = 0, totalFound = 0, totalMissing = 0;
  let totalMerged = 0, totalNoop = 0, totalStale = 0, totalFailed = 0;
  const touchedCanonicalIds: string[] = [];
  const dataIssues: any[] = [];

  while (batches < opts.max_batches) {
    // Pull next batch of target NAV source_external_id values.
    const { data: idRows, error: idErr } = await admin
      .from("source_postings")
      .select("source_external_id")
      .eq("source", "nav")
      .gt("source_external_id", cursorAfter)
      .order("source_external_id", { ascending: true })
      .limit(opts.repair_batch_size);
    if (idErr) {
      await admin.from("nav_repair_runs").update({
        status: "failed", finished_at: new Date().toISOString(),
        last_error: `target id scan: ${idErr.message}`,
      }).eq("id", repairRun.id);
      return { errorSummary: `system_error: target id scan: ${idErr.message}`, repair_run_id: repairRun.id };
    }
    const ids = (idRows ?? []).map((r: any) => r.source_external_id).filter(Boolean);
    if (ids.length === 0) {
      // Completed
      await admin.from("nav_repair_runs").update({
        status: "completed", finished_at: new Date().toISOString(),
      }).eq("id", repairRun.id);
      break;
    }

    const uniqIds = Array.from(new Set(ids));
    const { data: upstreamRows, error: upErr } = await navClient.rpc(
      "list_nav_opportunities_by_external_ids", { p_ids: uniqIds },
    );
    if (upErr) {
      await admin.from("nav_repair_runs").update({
        last_error: `upstream by-ids: ${upErr.message}`,
      }).eq("id", repairRun.id);
      return { errorSummary: `system_error: upstream by-ids: ${upErr.message}`, repair_run_id: repairRun.id };
    }
    const upRows: UpstreamRow[] = (upstreamRows ?? []) as UpstreamRow[];
    const foundMap = new Map<string, UpstreamRow>();
    for (const r of upRows) if (r?.external_id) foundMap.set(r.external_id, r);

    let batchFound = 0, batchMissing = 0, batchMerged = 0, batchNoop = 0, batchStale = 0, batchFailed = 0;

    for (const id of uniqIds) {
      const row = foundMap.get(id);
      if (!row) {
        batchMissing++;
        dataIssues.push({ external_id: id, reason: "upstream_missing" });
        continue;
      }
      batchFound++;
      const r = await processRow(admin, row);
      if (r.outcome === "noop") batchNoop++;
      else if (r.outcome === "stale") batchStale++;
      else if (r.outcome === "data_issue") {
        dataIssues.push({ external_id: id, reason: r.reason });
      } else if (r.outcome === "failed") {
        batchFailed++;
      } else {
        batchMerged++;
        if (r.isActive && r.canonicalId) touchedCanonicalIds.push(r.canonicalId);
      }
    }

    cursorAfter = uniqIds[uniqIds.length - 1];
    totalRequested += uniqIds.length;
    totalFound += batchFound;
    totalMissing += batchMissing;
    totalMerged += batchMerged;
    totalNoop += batchNoop;
    totalStale += batchStale;
    totalFailed += batchFailed;
    batches++;

    await admin.from("nav_repair_runs").update({
      cursor_after_external_id: cursorAfter,
      batches_processed: (repairRun.batches_processed ?? 0) + batches,
      ids_requested: (repairRun.ids_requested ?? 0) + totalRequested,
      ids_found: (repairRun.ids_found ?? 0) + totalFound,
      ids_missing: (repairRun.ids_missing ?? 0) + totalMissing,
      rows_merged: (repairRun.rows_merged ?? 0) + totalMerged,
      rows_noop: (repairRun.rows_noop ?? 0) + totalNoop,
      rows_stale_ignored: (repairRun.rows_stale_ignored ?? 0) + totalStale,
      rows_failed: (repairRun.rows_failed ?? 0) + totalFailed,
    }).eq("id", repairRun.id);

    // Stop early if upstream returned fewer than we asked for AND no missing items left (rare boundary)
    if (ids.length < opts.repair_batch_size) {
      await admin.from("nav_repair_runs").update({
        status: "completed", finished_at: new Date().toISOString(),
      }).eq("id", repairRun.id);
      break;
    }
  }

  return {
    errorSummary: null,
    repair_run_id: repairRun.id,
    cursor_after_external_id: cursorAfter,
    batches_processed: batches,
    requested: totalRequested, found: totalFound, missing: totalMissing,
    merged: totalMerged, noop: totalNoop, stale: totalStale, failed: totalFailed,
    dataIssues,
    touchedCanonicalIds,
  };
}

// ------- HANDLER -------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const provided = req.headers.get("x-sync-nav-secret") ?? "";
  if (!SYNC_NAV_SECRET || !provided || !timingSafeEqualStr(provided, SYNC_NAV_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "missing supabase env" }, 500);
  if (!NAV_SOURCE_URL || !NAV_SOURCE_KEY) return json({ ok: false, error: "missing NAV_SOURCE env" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const modeRaw = String(body?.mode ?? "cursor").toLowerCase();
  const mode = (modeRaw === "repair_by_ids" || modeRaw === "repair") ? "repair_by_ids" : "cursor";
  const repair_batch_size = Math.max(1, Math.min(REPAIR_BATCH_MAX, Number(body?.repair_batch_size ?? REPAIR_BATCH_DEFAULT)));
  const max_batches = Math.max(1, Math.min(REPAIR_BATCHES_MAX, Number(body?.max_batches ?? 1)));
  const repair_run_id = typeof body?.repair_run_id === "string" ? body.repair_run_id : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Global target writer lease — single serializer across cursor + repair_by_ids.
  // We claim BEFORE inserting a run row so already_running paths leave no side effects.
  const probeId = crypto.randomUUID();
  const probe = await claimLease(admin, probeId, mode);
  if (!probe.ok) {
    return json({
      ok: true, status: "already_running", mode,
      lease: {
        owner_run_id: probe.owner_run_id ?? null,
        owner_mode: probe.owner_mode ?? null,
        expires_at: probe.expires_at ?? null,
      },
    });
  }


  // Last successful cursor-mode run is the source of cursor tuple.
  const { data: lastDone } = await admin
    .from("nav_sync_runs")
    .select("id, meta")
    .not("finished_at", "is", null)
    .is("error_summary", null)
    .order("finished_at", { ascending: false })
    .limit(20);
  const lastCursorRun = (lastDone ?? []).find((r: any) =>
    String(r?.meta?.mode ?? "cursor") === "cursor");
  const meta0 = (lastCursorRun?.meta as any) ?? {};
  const prevRunId = lastCursorRun?.id ?? null;

  const { data: runRow, error: runErr } = await admin
    .from("nav_sync_runs").insert({
      meta: {
        mode,
        cursor_changed_at: meta0.cursor_changed_at ?? null,
        cursor_external_id: meta0.cursor_external_id ?? null,
        model: AI_MODEL,
        prev_run_id: prevRunId,
        repair_batch_size: mode === "repair_by_ids" ? repair_batch_size : undefined,
        max_batches: mode === "repair_by_ids" ? max_batches : undefined,
        repair_run_id_input: repair_run_id ?? undefined,
      },
    }).select("id").single();
  if (runErr || !runRow) return json({ ok: false, error: `run insert failed: ${runErr?.message}` }, 500);
  const runId = runRow.id;

  const navClient = createClient(NAV_SOURCE_URL, NAV_SOURCE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let fetched = 0, upserted = 0, expired = 0, reactivated = 0;
  let noopCount = 0, staleCount = 0;
  let matched_user_opps = 0, scored = 0;
  let errorSummary: string | null = null;
  const dataIssues: any[] = [];
  const systemErrors: any[] = [];
  const aiErrors: any[] = [];
  const finalMeta: any = { mode, model: AI_MODEL, prev_run_id: prevRunId };

  try {
    if (mode === "cursor") {
      const res = await runCursorMode(admin, navClient, meta0);
      fetched = res.fetched; upserted = res.upserted; expired = res.expired; reactivated = res.reactivated;
      noopCount = res.noop; staleCount = res.stale;
      dataIssues.push(...res.dataIssues); systemErrors.push(...res.systemErrors);
      errorSummary = res.errorSummary;
      finalMeta.cursor_changed_at = res.cursorChangedAt;
      finalMeta.cursor_external_id = res.cursorExternalId;
      finalMeta.noop = noopCount; finalMeta.stale = staleCount;
      if (!errorSummary && res.touchedCanonicalIds.length) {
        const m = await runMatching(admin, res.touchedCanonicalIds);
        matched_user_opps = m.matched_user_opps; scored = m.scored;
        aiErrors.push(...m.aiErrors);
      }
    } else {
      const res = await runRepairMode(admin, navClient, { repair_batch_size, max_batches, repair_run_id });
      errorSummary = res.errorSummary ?? null;
      fetched = res.requested ?? 0;
      upserted = res.merged ?? 0;
      noopCount = res.noop ?? 0; staleCount = res.stale ?? 0;
      finalMeta.repair_run_id = res.repair_run_id;
      finalMeta.cursor_after_external_id = res.cursor_after_external_id;
      finalMeta.batches_processed = res.batches_processed;
      finalMeta.requested = res.requested;
      finalMeta.found = res.found;
      finalMeta.missing = res.missing;
      finalMeta.merged = res.merged;
      finalMeta.noop = res.noop;
      finalMeta.stale = res.stale;
      finalMeta.failed = res.failed;
      if (Array.isArray(res.dataIssues)) dataIssues.push(...res.dataIssues);
      // Repair mode: do NOT score historical rows (matching only on touched ACTIVE+grace, gated already).
      if (!errorSummary && res.touchedCanonicalIds?.length) {
        const m = await runMatching(admin, res.touchedCanonicalIds);
        matched_user_opps = m.matched_user_opps; scored = m.scored;
        aiErrors.push(...m.aiErrors);
      }
    }
  } catch (e: any) {
    errorSummary = `system_error: ${String(e?.message ?? e)}`;
    systemErrors.push({ error: String(e?.message ?? e) });
  }

  finalMeta.dataIssues = dataIssues.slice(0, 200);
  finalMeta.systemErrors = systemErrors.slice(0, 50);
  finalMeta.aiErrors = aiErrors.slice(0, 50);

  await admin.from("nav_sync_runs").update({
    finished_at: new Date().toISOString(),
    fetched, upserted, expired, reactivated, matched_user_opps, scored,
    error_summary: errorSummary, meta: finalMeta,
  }).eq("id", runId);

  return json({
    ok: errorSummary == null,
    run_id: runId, mode,
    fetched, upserted, expired, reactivated, noop: noopCount, stale: staleCount,
    matched_user_opps, scored,
    repair: mode === "repair_by_ids" ? {
      repair_run_id: finalMeta.repair_run_id,
      cursor_after_external_id: finalMeta.cursor_after_external_id,
      batches_processed: finalMeta.batches_processed,
      requested: finalMeta.requested, found: finalMeta.found, missing: finalMeta.missing,
      merged: finalMeta.merged, noop: finalMeta.noop, stale: finalMeta.stale, failed: finalMeta.failed,
    } : undefined,
    error_summary: errorSummary,
  });
});
