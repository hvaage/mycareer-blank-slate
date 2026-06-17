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

const BATCH_LIMIT = 4000;
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
  nav_detail: Record<string, unknown> | null;
  description_excerpt?: string | null;
};

function mergeNavPayload(existing: any, incoming: NavRow): Record<string, unknown> {
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
  } else {
    // INACTIVE: bevar eksisterende nav_detail; ikke overskriv.
    if (!base.nav_detail && incoming.nav_detail) base.nav_detail = incoming.nav_detail;
    base.nav_inactive_event = {
      at: incoming.changed_at,
      external_id: incoming.external_id,
    };
    base.last_nav_status = "INACTIVE";
    base.last_nav_changed_at = incoming.changed_at;
  }
  return base;
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
        const rows: NavRow[] = (navRows ?? []) as any;
        fetched = rows.length;

        const newCanonicalIds: string[] = [];

        for (const row of rows) {
          try {
            if (!row.external_id || !row.title || !row.employer) {
              dataIssues.push({ external_id: row.external_id, reason: "missing required field" });
              cursorChangedAt = row.changed_at ?? cursorChangedAt;
              cursorExternalId = row.external_id ?? cursorExternalId;
              continue;
            }

            const safeUrl =
              (row.url && row.url.trim()) ||
              `https://arbeidsplassen.nav.no/stillinger/stilling/${row.external_id}`;

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
              .select("id, raw_payload, posting_status")
              .eq("source", "nav")
              .eq("source_external_id", row.external_id)
              .maybeSingle();

            const mergedPayload = mergeNavPayload(existingSp?.raw_payload ?? null, row);
            const wasInactive = existingSp?.posting_status === "expired" || existingSp?.posting_status === "removed";
            const isActive = row.status === "ACTIVE";

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
              last_seen_at: new Date().toISOString(),
              posting_status: isActive ? "active" : "expired",
              expired_at: isActive ? null : (existingSp ? undefined : new Date().toISOString()),
              updated_at: new Date().toISOString(),
            };
            if (!isActive && !existingSp) spUpsert.expired_at = new Date().toISOString();
            if (!isActive && existingSp && (existingSp as any).expired_at == null) {
              spUpsert.expired_at = new Date().toISOString();
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
        if (!errorSummary && newCanonicalIds.length > 0) {
          // Fetch active canonical with their NAV source posting
          const { data: activeCanon } = await admin
            .from("canonical_opportunities")
            .select("id, display_title, display_company, display_location, display_url, live_until")
            .in("id", newCanonicalIds)
            .is("live_until", null);

          const { data: profiles } = await admin
            .from("profiles")
            .select("id, job_search_keywords, preferred_locations");

          const usersToScore: { userId: string; canonicalId: string; co: any }[] = [];

          for (const co of activeCanon ?? []) {
            const titleLc = (co.display_title ?? "").toLowerCase();
            const locLc = (co.display_location ?? "").toLowerCase();
            for (const p of profiles ?? []) {
              const kws: string[] = Array.isArray((p as any).job_search_keywords)
                ? (p as any).job_search_keywords
                : [];
              const locs: string[] = Array.isArray((p as any).preferred_locations)
                ? (p as any).preferred_locations
                : [];
              const kwMatch = kws.length === 0
                ? false
                : kws.some((k) => k && titleLc.includes(String(k).toLowerCase()));
              const locMatch = locs.length === 0
                ? true
                : locs.some((l) => l && locLc.includes(String(l).toLowerCase()));
              if (!kwMatch || !locMatch) continue;

              const { data: fpRow } = await admin
                .from("canonical_opportunities")
                .select("identity_fingerprint")
                .eq("id", co.id)
                .maybeSingle();
              const ins = await admin
                .from("user_opportunities")
                .insert({
                  user_id: (p as any).id,
                  canonical_opportunity_id: co.id,
                  identity_fingerprint: fpRow?.identity_fingerprint ?? "",
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
                usersToScore.push({ userId: (p as any).id, canonicalId: co.id, co });
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
