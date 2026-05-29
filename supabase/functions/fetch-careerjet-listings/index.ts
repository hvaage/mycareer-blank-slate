import { createClient } from "npm:@supabase/supabase-js@2";

const CAREERJET_API = "http://public.api.careerjet.net/search";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://karrierenmin.no/";
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const DELAY_MS = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeExternalId(stableUrlKey: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableUrlKey));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "cj_" + hex.slice(0, 16);
}

/** Match `normalize_lead_key` URL normalization so external_id aligns with dedupe keys. */
function normalizeUrlForDedupe(raw: string): string {
  let u = raw.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/[?#].*$/, "");
  u = u.replace(/\/+$/, "");
  u = u.replace(/^www\./, "");
  return u;
}

async function getCachedCmpDedupeKey(
  client: ReturnType<typeof createClient>,
  cache: Map<string, string>,
  company: string,
  title: string,
  location: string,
): Promise<string> {
  const mem = `${company}\x00${title}\x00${location}`;
  if (cache.has(mem)) return cache.get(mem)!;
  const { data, error } = await client.rpc("normalize_lead_key", {
    p_url: "",
    p_company: company,
    p_title: title,
    p_location: location,
  });
  if (error) {
    console.error("[fetch-careerjet] normalize_lead_key (cmp) failed:", error);
  }
  const k = typeof data === "string" && data.length > 0 ? data : `cmp:rpc_error|${mem}`;
  cache.set(mem, k);
  return k;
}

async function mergeCareerjetJobsByCmpKey(
  client: ReturnType<typeof createClient>,
  jobs: Record<string, unknown>[],
  cache: Map<string, string>,
): Promise<{ merged: Record<string, unknown>[]; collapsed: number }> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const job of jobs) {
    const ck = await getCachedCmpDedupeKey(
      client,
      cache,
      String(job.employer ?? ""),
      String(job.title ?? ""),
      String(job.location ?? ""),
    );
    const arr = groups.get(ck) ?? [];
    arr.push(job);
    groups.set(ck, arr);
  }
  let collapsed = 0;
  const merged: Record<string, unknown>[] = [];
  for (const arr of groups.values()) {
    if (arr.length > 1) collapsed += arr.length - 1;
    arr.sort((a, b) => {
      const ta = a.published_at ? new Date(String(a.published_at)).getTime() : 0;
      const tb = b.published_at ? new Date(String(b.published_at)).getTime() : 0;
      if (tb !== ta) return tb - ta;
      const sa = normalizeUrlForDedupe(String(a.source_url ?? ""));
      const sb = normalizeUrlForDedupe(String(b.source_url ?? ""));
      if (sa !== sb) return sa.localeCompare(sb);
      return String(a.external_id ?? "").localeCompare(String(b.external_id ?? ""));
    });
    merged.push(arr[0]);
  }
  return { merged, collapsed };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function buildSearches(keywords: string[], locations: string[]): Array<{ kw: string; loc: string }> {
  const kws = keywords.filter(Boolean).slice(0, 3);
  const locs = locations.filter(Boolean).slice(0, 3);
  if (kws.length === 0 && locs.length === 0) return [];
  const combos: Array<{ kw: string; loc: string }> = [];
  const kwList = kws.length > 0 ? kws : [""];
  const locList = locs.length > 0 ? locs : [""];
  for (const kw of kwList) for (const loc of locList) combos.push({ kw, loc });
  return combos.slice(0, 6);
}

function safeDisplayUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "about:blank";
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "about:blank";
    return u.href.slice(0, 2048);
  } catch {
    return "about:blank";
  }
}

function isJobviewtrackUrlEdge(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const h = new URL(t.startsWith("http") ? t : `https://${t}`).hostname.toLowerCase();
    return h.includes("jobviewtrack.com");
  } catch {
    return /jobviewtrack\.com/i.test(t);
  }
}

function careerjetJobbsoekUrlEdge(title: string, company: string, location: string): string {
  const params = new URLSearchParams();
  const keywords = [title, company].filter(Boolean).join(" ").trim();
  if (keywords) params.set("s", keywords);
  if (location) params.set("l", location.split(",")[0].trim());
  const qs = params.toString();
  return qs ? `https://www.careerjet.no/jobbsoek?${qs}` : "https://www.careerjet.no/";
}

/** Public browse URL for cards; avoid storing jobviewtrack as the primary display link. */
function effectiveCardDisplayUrl(rawUrl: string, title: string, company: string, location: string): string {
  if (isJobviewtrackUrlEdge(rawUrl)) return careerjetJobbsoekUrlEdge(title, company, location);
  return safeDisplayUrl(rawUrl);
}

function formatCardSalaryFields(l: Record<string, unknown>): {
  text: string | null;
  min: number | null;
  max: number | null;
  cur: string | null;
} {
  const min = l.salary_min != null ? Number(l.salary_min) : null;
  const max = l.salary_max != null ? Number(l.salary_max) : null;
  const cur = l.salary_currency != null ? String(l.salary_currency) : null;
  const raw = l.salary != null ? String(l.salary) : null;
  let text: string | null = null;
  if (min != null || max != null) {
    const fmt = (n: number) => n.toLocaleString("nb-NO");
    const range = min != null && max != null ? `${fmt(min)} – ${fmt(max)}` : fmt((min ?? max)!);
    text = `${range} ${cur ?? ""}`.trim();
  } else text = raw;
  return { text, min, max, cur };
}

/** Dual-write canonical opportunity stack (Careerjet). Legacy tables unchanged. */
async function syncCanonicalCareerjetRow(
  client: ReturnType<typeof createClient>,
  userId: string,
  jl: Record<string, unknown>,
  legacyListingStatusId: string,
  profile: Record<string, unknown>,
  nowIso: string,
): Promise<void> {
  const company = String(jl.employer ?? "");
  const title = String(jl.title ?? "");
  const location = String(jl.location ?? "");
  const rawUrl = String(jl.source_url ?? "");
  const extId = String(jl.external_id ?? "");
  const listingId = String(jl.id ?? "");
  if (!extId || !listingId || !legacyListingStatusId) return;

  const { data: fpRaw, error: fpErr } = await client.rpc("opportunity_fingerprint", {
    p_company: company,
    p_title: title,
    p_location: location,
  });
  if (fpErr || typeof fpRaw !== "string" || !fpRaw.startsWith("fp1:")) {
    console.error("[fetch-careerjet] opportunity_fingerprint failed", fpErr);
    return;
  }
  const fingerprint = fpRaw as string;
  const displayUrl = effectiveCardDisplayUrl(rawUrl, title, company, location);
  const sal = formatCardSalaryFields(jl);

  const { data: canonRow, error: cErr } = await client
    .from("canonical_opportunities")
    .upsert(
      {
        identity_fingerprint: fingerprint,
        display_title: jl.title ?? null,
        display_company: jl.employer ?? null,
        display_location: jl.location ?? null,
        display_url: displayUrl,
        primary_source: "careerjet",
        merge_summary: "careerjet_fetch",
        updated_at: nowIso,
      },
      { onConflict: "identity_fingerprint" },
    )
    .select("id")
    .maybeSingle();

  if (cErr || !canonRow?.id) {
    console.error("[fetch-careerjet] canonical_opportunities upsert", cErr);
    return;
  }
  const canonId = canonRow.id as string;

  const { data: spRow, error: spErr } = await client
    .from("source_postings")
    .upsert(
      {
        source: "careerjet",
        source_external_id: extId,
        listing_id: listingId,
        raw_url: rawUrl,
        display_url: displayUrl,
        title: jl.title ?? null,
        company: jl.employer ?? null,
        location: jl.location ?? null,
        description_excerpt: jl.description ? String(jl.description).slice(0, 800) : null,
        raw_payload: jl.raw_data ?? null,
        identity_fingerprint: fingerprint,
        published_at: jl.published_at ?? null,
        updated_at: nowIso,
      },
      { onConflict: "source,source_external_id" },
    )
    .select("id")
    .maybeSingle();

  if (spErr || !spRow?.id) {
    console.error("[fetch-careerjet] source_postings upsert", spErr);
    return;
  }
  const postingId = spRow.id as string;

  const { data: primary } = await client
    .from("opportunity_source_links")
    .select("id, source_posting_id")
    .eq("canonical_opportunity_id", canonId)
    .eq("link_role", "primary")
    .maybeSingle();

  const mergeReasonFirst = "first_source_posting_for_fingerprint";
  const mergeReasonVariant = "same_opportunity_fingerprint_additional_careerjet_url";

  if (!primary) {
    const { error: insP } = await client.from("opportunity_source_links").insert({
      canonical_opportunity_id: canonId,
      source_posting_id: postingId,
      link_role: "primary",
      merge_reason: mergeReasonFirst,
    });
    if (insP) console.error("[fetch-careerjet] primary link", insP);
  } else if (primary.source_posting_id !== postingId) {
    const { error: vErr } = await client.from("opportunity_source_links").upsert(
      {
        canonical_opportunity_id: canonId,
        source_posting_id: postingId,
        link_role: "variant",
        merge_reason: mergeReasonVariant,
      },
      { onConflict: "canonical_opportunity_id,source_posting_id" },
    );
    if (!vErr) {
      await client.from("opportunity_dedup_decisions").insert({
        user_id: userId,
        keep_canonical_id: canonId,
        merged_canonical_id: null,
        decision_type: "auto_source_variant",
        reason: mergeReasonVariant,
      });
    }
  }

  const { data: ujRow } = await client
    .from("user_job_listing_status")
    .select("ai_score, ai_reasoning, ai_match_highlights, ai_concerns, ai_scored_at, status")
    .eq("id", legacyListingStatusId)
    .maybeSingle();

  const { data: existingUo } = await client
    .from("user_opportunities")
    .select("id, status, relevance_score")
    .eq("user_id", userId)
    .eq("canonical_opportunity_id", canonId)
    .maybeSingle();

  const lockedStatus = existingUo?.status &&
    ["dismissed", "applied", "saved"].includes(existingUo.status as string);
  const nextStatus = lockedStatus
    ? (existingUo!.status as string)
    : (ujRow?.status as string) === "dismissed"
    ? "dismissed"
    : (existingUo?.status as string | undefined) ?? "new";

  const rel = scoreListingForUser(jl, profile);
  const relOut = existingUo?.relevance_score != null && Number(existingUo.relevance_score) > rel
    ? existingUo.relevance_score
    : rel;

  const { error: uoErr } = await client.from("user_opportunities").upsert(
    {
      user_id: userId,
      canonical_opportunity_id: canonId,
      identity_fingerprint: fingerprint,
      status: nextStatus,
      relevance_score: relOut,
      ai_score: ujRow?.ai_score ?? null,
      ai_reasoning: ujRow?.ai_reasoning ?? null,
      ai_match_highlights: ujRow?.ai_match_highlights ?? null,
      ai_concerns: ujRow?.ai_concerns ?? null,
      ai_scored_at: ujRow?.ai_scored_at ?? null,
      legacy_listing_status_id: legacyListingStatusId,
      legacy_listing_id: listingId,
      card_title: jl.title ?? null,
      card_company: jl.employer ?? null,
      card_location: jl.location ?? null,
      card_salary: sal.text,
      card_salary_min: sal.min,
      card_salary_max: sal.max,
      card_salary_currency: sal.cur,
      card_display_url: displayUrl,
      card_raw_url: rawUrl,
      card_published_at: jl.published_at ?? null,
      updated_at: nowIso,
    },
    { onConflict: "user_id,canonical_opportunity_id" },
  );
  if (uoErr) console.error("[fetch-careerjet] user_opportunities upsert", uoErr);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(
    req.headers.get("Authorization")?.replace("Bearer ", "") ?? "",
  );
  if (!user || authError) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "1.1.1.1";
  const userAgent = req.headers.get("user-agent") ?? "karrierenmin.no/1.0";

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("preferred_locations, job_search_keywords, target_role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return new Response(JSON.stringify({ error: "Profil ikke funnet" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const affid = Deno.env.get("CAREERJET_AFFID") ?? "";
  const rawKw = profile.job_search_keywords || profile.target_role || "";
  const keywords = rawKw.split(",").map((k: string) => k.trim()).filter(Boolean);
  const locations: string[] = profile.preferred_locations ?? [];

  const searches = buildSearches(keywords, locations);
  if (searches.length === 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        message:
          "Ingen søkekriterier. Gå til Profil → Jobbsøk-innstillinger og legg inn søkeord eller byer.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const allJobs: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  for (const { kw, loc } of searches) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        locale_code: "nb_NO",
        affid,
        user_ip: userIp,
        user_agent: userAgent,
        pagesize: String(PAGE_SIZE),
        page: String(page),
        sort: "date",
      });
      if (kw) params.set("keywords", kw);
      // Strip "By — Kommune, Fylke" suffix; Careerjet works best with just the place name.
      const locName = loc ? loc.split("—")[0].trim() : "";
      if (locName) params.set("location", locName);

      try {
        const res = await fetch(`${CAREERJET_API}?${params}`, {
          headers: { Referer: SITE_URL },
        });
        if (!res.ok) {
          console.error(`Careerjet feil: ${res.status} for ${kw}/${loc}`);
          break;
        }
        const data = await res.json();
        if (data.type !== "JOBS" || !data.jobs?.length) break;

        for (const job of data.jobs as Record<string, unknown>[]) {
          const rawUrl = String(job.url ?? "");
          const stableKey = normalizeUrlForDedupe(rawUrl) || rawUrl;
          const id = await makeExternalId(stableKey);
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          allJobs.push({
            external_id: id,
            source: "careerjet",
            title: String(job.title ?? "").trim() || null,
            employer: String(job.company ?? "").trim() || null,
            description: job.description ? stripHtml(String(job.description)) : null,
            location: String(job.locations ?? "").split(",")[0].trim() || null,
            municipality: String(job.locations ?? "").split(",")[0].trim() || null,
            salary: job.salary ? String(job.salary) : null,
            salary_min: job.salary_min ? Number(job.salary_min) : null,
            salary_max: job.salary_max ? Number(job.salary_max) : null,
            salary_currency: job.salary_currency_code ? String(job.salary_currency_code) : null,
            published_at: job.date ? new Date(String(job.date)).toISOString() : null,
            expires_at: job.date
              ? new Date(new Date(String(job.date)).getTime() + 30 * 86_400_000).toISOString()
              : null,
            source_url: rawUrl,
            raw_data: job,
            is_expired: false,
            updated_at: new Date().toISOString(),
          });
        }
        if (page >= (data.pages ?? page)) break;
      } catch (err) {
        console.error(`Feil ved henting ${kw}/${loc} side ${page}:`, err);
        break;
      }
      await sleep(DELAY_MS);
    }
    await sleep(DELAY_MS);
  }

  if (allJobs.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        fetched: 0,
        upserted: 0,
        scored: 0,
        message: "Ingen annonser funnet. Juster søkeord eller lokasjoner.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const cmpKeyCache = new Map<string, string>();
  const { merged: mergedJobs, collapsed: cmp_merge_collapsed } = await mergeCareerjetJobsByCmpKey(
    serviceClient,
    allJobs,
    cmpKeyCache,
  );
  if (cmp_merge_collapsed > 0) {
    console.log(
      `[fetch-careerjet] cmp-key merge collapsed ${cmp_merge_collapsed} duplicate URL variants (same company/title/location)`,
    );
  }

  const jobsToUpsert = mergedJobs;
  await serviceClient.rpc("prune_stale_leads", { p_user_id: user.id });

  const { data: upserted, error: upsertErr } = await serviceClient
    .from("job_listings")
    .upsert(jobsToUpsert, { onConflict: "external_id", ignoreDuplicates: false })
    .select("*");

  if (upsertErr) {
    console.error("Upsert feilet:", upsertErr);
    return new Response(JSON.stringify({ error: "DB-feil ved lagring" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();
  let skipped = 0;
  let refreshed = 0;
  const statusRows: Record<string, unknown>[] = [];
  /** listing_id → user_job_listing_status.id for canonical dual-write */
  const listingToLegacyStatusId = new Map<string, string>();
  /** `register_lead` + `lead_dedupe_keys` use company|title|location (cmp:) so URL variants cannot create parallel user-visible leads. */
  const listingIdToRegisterDedupeKey = new Map<string, string>();
  const dedupeDiagnostics: Record<string, unknown>[] = [];
  const DIAG_MAX = 30;

  for (const listing of (upserted ?? []) as Record<string, unknown>[]) {
    const rawUrl = String(listing.source_url ?? "");
    const normUrl = normalizeUrlForDedupe(rawUrl);
    const extId = String(listing.external_id ?? "");

    const { data: urlKeyData } = await serviceClient.rpc("normalize_lead_key", {
      p_url: rawUrl,
      p_company: String(listing.employer ?? ""),
      p_title: String(listing.title ?? ""),
      p_location: String(listing.location ?? ""),
    });
    const urlDedupeKey = typeof urlKeyData === "string" ? urlKeyData : "";

    const registerDedupeKey = await getCachedCmpDedupeKey(
      serviceClient,
      cmpKeyCache,
      String(listing.employer ?? ""),
      String(listing.title ?? ""),
      String(listing.location ?? ""),
    );
    listingIdToRegisterDedupeKey.set(String(listing.id), registerDedupeKey);

    if (dedupeDiagnostics.length < DIAG_MAX) {
      console.log(
        JSON.stringify({
          tag: "careerjet_dedupe",
          raw_url: rawUrl.slice(0, 400),
          normalized_url: normUrl.slice(0, 400),
          external_id: extId,
          url_dedupe_key: urlDedupeKey.slice(0, 400),
          register_dedupe_key: registerDedupeKey.slice(0, 400),
          listing_id: listing.id,
        }),
      );
    }

    const { data: allowed } = await serviceClient.rpc("register_lead", {
      p_user_id: user.id,
      p_source: "careerjet",
      p_priority: 1,
      p_dedupe_key: registerDedupeKey,
      p_ref_table: "user_job_listing_status",
      p_ref_id: null,
    });
    if (allowed !== true) {
      skipped += 1;
      const relScore = scoreListingForUser(listing, profile);
      const { error: upExistingErr } = await serviceClient
        .from("user_job_listing_status")
        .update({
          relevance_score: relScore,
          updated_at: now,
        })
        .eq("user_id", user.id)
        .eq("listing_id", listing.id as string);
      let userStatusId: string | null = null;
      if (!upExistingErr) {
        refreshed += 1;
        const { data: st } = await serviceClient
          .from("user_job_listing_status")
          .select("id")
          .eq("user_id", user.id)
          .eq("listing_id", listing.id as string)
          .maybeSingle();
        userStatusId = (st?.id as string) ?? null;
        if (st?.id) {
          listingToLegacyStatusId.set(String(listing.id), st.id as string);
          await serviceClient
            .from("lead_dedupe_keys")
            .update({
              ref_table: "user_job_listing_status",
              ref_id: st.id as string,
              updated_at: now,
            })
            .eq("user_id", user.id)
            .eq("dedupe_key", registerDedupeKey)
            .is("ref_id", null);
        }
      }
      if (dedupeDiagnostics.length < DIAG_MAX) {
        dedupeDiagnostics.push({
          raw_url: rawUrl.slice(0, 400),
          normalized_url: normUrl.slice(0, 400),
          external_id: extId,
          url_dedupe_key: urlDedupeKey,
          register_dedupe_key: registerDedupeKey,
          listing_id: listing.id,
          user_status_id: userStatusId,
          register_allowed: false,
        });
      }
      continue;
    }
    statusRows.push({
      user_id: user.id,
      listing_id: listing.id,
      status: "new",
      relevance_score: scoreListingForUser(listing, profile),
      updated_at: now,
    });
    if (dedupeDiagnostics.length < DIAG_MAX) {
      dedupeDiagnostics.push({
        raw_url: rawUrl.slice(0, 400),
        normalized_url: normUrl.slice(0, 400),
        external_id: extId,
        url_dedupe_key: urlDedupeKey,
        register_dedupe_key: registerDedupeKey,
        listing_id: listing.id,
        user_status_id: null,
        register_allowed: true,
      });
    }
  }

  let linkedStatusIds: { id: string; listing_id: string }[] = [];
  if (statusRows.length > 0) {
    const { data: inserted, error: stErr } = await serviceClient
      .from("user_job_listing_status")
      .upsert(statusRows, { onConflict: "user_id,listing_id", ignoreDuplicates: false })
      .select("id, listing_id");
    if (stErr) {
      console.error("user_job_listing_status upsert:", stErr);
    } else {
      linkedStatusIds = (inserted ?? []) as { id: string; listing_id: string }[];
    }
  }

  const listingIdToNewStatusId = new Map<string, string>(
    linkedStatusIds.map((r) => [r.listing_id, r.id]),
  );
  for (let i = 0; i < dedupeDiagnostics.length; i++) {
    const row = dedupeDiagnostics[i];
    const lid = row.listing_id as string | undefined;
    if (lid && row.register_allowed === true && row.user_status_id == null) {
      const sid = listingIdToNewStatusId.get(lid);
      if (sid) row.user_status_id = sid;
    }
  }

  for (const row of linkedStatusIds) {
    const dk = listingIdToRegisterDedupeKey.get(row.listing_id);
    if (!dk) continue;
    listingToLegacyStatusId.set(row.listing_id, row.id);
    await serviceClient
      .from("lead_dedupe_keys")
      .update({
        ref_table: "user_job_listing_status",
        ref_id: row.id,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .eq("dedupe_key", dk)
      .is("ref_id", null);
  }

  let canonicalSynced = 0;
  try {
    for (const listing of (upserted ?? []) as Record<string, unknown>[]) {
      const legacySid = listingToLegacyStatusId.get(String(listing.id ?? ""));
      if (!legacySid) continue;
      await syncCanonicalCareerjetRow(
        serviceClient,
        user.id,
        listing,
        legacySid,
        profile,
        now,
      );
      canonicalSynced += 1;
    }
  } catch (e) {
    console.error("[fetch-careerjet] canonical opportunity sync", e);
  }

  // ---- AI scoring (per-user) on newly-inserted listings ----
  // Score listings that don't yet have ai_scored_at, in batches.
  let aiScored = 0;
  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableKey) {
      // Score any of the user's listing-status rows that don't have AI scoring yet,
      // not just the ones inserted in this run. This backfills historical leads too.
      const { data: needScoring } = await serviceClient
        .from("user_job_listing_status")
        .select("id, listing_id, listing:job_listings ( id, title, employer, location, salary, description, source_url )")
        .eq("user_id", user.id)
        .is("ai_scored_at", null)
        .limit(40);

      if (needScoring && needScoring.length > 0) {
        aiScored = await scoreListingsWithAi(serviceClient, lovableKey, profile, needScoring as any);
      }
    }
  } catch (e) {
    console.error("[fetch-careerjet] AI scoring error:", e);
  }

  try {
    const { error: syncAiErr2 } = await serviceClient.rpc("sync_user_opportunity_ai_from_legacy", {
      p_user_id: user.id,
    });
    if (syncAiErr2) console.error("[fetch-careerjet] sync_user_opportunity_ai_from_legacy (post-ai)", syncAiErr2);
  } catch (e) {
    console.error("[fetch-careerjet] post-ai canonical sync", e);
  }

  await serviceClient
    .from("profiles")
    .update({ listings_last_fetched_at: now })
    .eq("id", user.id);

  return new Response(
    JSON.stringify({
      ok: true,
      searches: searches.length,
      fetched: allJobs.length,
      merged_for_upsert: jobsToUpsert.length,
      cmp_merge_collapsed: cmp_merge_collapsed,
      listing_rows_upserted: upserted?.length ?? 0,
      new_lead_links: statusRows.length,
      skipped_duplicates: skipped,
      existing_rows_refreshed: refreshed,
      ai_scored: aiScored,
      dedupe_diagnostics: dedupeDiagnostics,
      canonical_rows_synced: canonicalSynced,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function scoreListingForUser(
  listing: Record<string, unknown>,
  profile: Record<string, unknown>,
): number {
  let score = 0;
  const title = String(listing.title ?? "").toLowerCase();
  const location = String(listing.location ?? "").toLowerCase();
  const keywords = String(profile.job_search_keywords ?? profile.target_role ?? "")
    .split(",")
    .map((k: string) => k.trim().toLowerCase())
    .filter(Boolean);
  const preferredLocations = ((profile.preferred_locations ?? []) as string[]).map((l: string) =>
    l.toLowerCase(),
  );

  if (keywords.some((kw) => kw && title.includes(kw))) score += 40;
  if (preferredLocations.some((loc) => location.includes(loc))) score += 30;
  if (listing.salary_min) score += 5;

  const published = listing.published_at ? new Date(String(listing.published_at)) : null;
  const daysOld = published ? (Date.now() - published.getTime()) / 86_400_000 : 99;
  if (daysOld < 1) score += 25;
  else if (daysOld < 3) score += 15;
  else if (daysOld < 7) score += 5;

  return Math.min(score, 100);
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function scoreListingsWithAi(
  client: ReturnType<typeof createClient>,
  apiKey: string,
  profile: Record<string, unknown>,
  rows: Array<{
    id: string;
    listing_id: string;
    listing: {
      id: string;
      title: string | null;
      employer: string | null;
      location: string | null;
      salary: string | null;
      description: string | null;
      source_url: string | null;
    } | null;
  }>,
): Promise<number> {
  const items = rows
    .filter((r) => r.listing)
    .map((r, i) => ({
      idx: i,
      row_id: r.id,
      title: r.listing!.title ?? "",
      company: r.listing!.employer ?? "",
      location: r.listing!.location ?? "",
      salary: r.listing!.salary ?? "",
      description: (r.listing!.description ?? "").slice(0, 1200),
    }));
  if (items.length === 0) return 0;

  const profileSlim = {
    target_roles: (profile as any).target_roles,
    target_seniority: (profile as any).target_seniority,
    target_industries: (profile as any).target_industries,
    target_country: (profile as any).target_country,
    target_region: (profile as any).target_region,
    target_city: (profile as any).target_city,
    work_types: (profile as any).work_types,
    skills: (profile as any).skills,
    languages: (profile as any).languages,
    salary_expectation_min: (profile as any).salary_expectation_min,
    salary_expectation_max: (profile as any).salary_expectation_max,
    salary_currency: (profile as any).salary_currency,
    motivation: (profile as any).motivation,
    strengths: (profile as any).strengths,
    deal_breakers: (profile as any).deal_breakers,
    years_experience: (profile as any).years_experience,
  };

  const prompt = `Du scorer Careerjet-jobbannonser mot en kandidatprofil.

KANDIDATPROFIL:
${JSON.stringify(profileSlim, null, 2)}

ANNONSER (idx, tittel, selskap, sted, lønn, beskrivelse):
${JSON.stringify(items, null, 2)}

Returner KUN gyldig JSON (ingen markdown):
{
  "scores": [
    {
      "idx": <number>,
      "row_id": "<string>",
      "ai_score": <0-100>,
      "ai_reasoning": "<1-2 setninger på norsk>",
      "ai_match_highlights": "<kort: hva passer (norsk)>",
      "ai_concerns": "<kort: hva passer dårlig eller mangler (norsk, kan være tom)>"
    }
  ]
}

Scoring:
- 80-100: sterk match på rolle/seniority + lokasjon/work_type + skills/industri
- 60-79: god match på rolle og 1-2 andre faktorer
- 40-59: delvis match
- 0-39: lite relevant`;

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    console.error("[fetch-careerjet] AI gateway", res.status, await res.text());
    return 0;
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: { scores?: Array<{ row_id: string; ai_score: number; ai_reasoning?: string; ai_match_highlights?: string; ai_concerns?: string }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error("[fetch-careerjet] AI returned non-JSON:", content.slice(0, 500));
    return 0;
  }
  const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
  const nowIso = new Date().toISOString();
  let n = 0;
  for (const s of scores) {
    if (!s?.row_id) continue;
    const aiScore = typeof s.ai_score === "number" ? Math.max(0, Math.min(100, Math.round(s.ai_score))) : null;
    const { error } = await (client.from("user_job_listing_status") as any)
      .update({
        ai_score: aiScore,
        ai_reasoning: s.ai_reasoning ?? null,
        ai_match_highlights: s.ai_match_highlights ?? null,
        ai_concerns: s.ai_concerns ?? null,
        ai_scored_at: nowIso,
        relevance_score: aiScore ?? undefined,
        updated_at: nowIso,
      })
      .eq("id", s.row_id);
    if (!error) n++;
  }
  return n;
}
