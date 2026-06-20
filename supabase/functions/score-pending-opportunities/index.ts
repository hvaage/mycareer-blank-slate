// score-pending-opportunities (Rev 4)
// Scores user_opportunities that lack ai_scored_at, scoped to the verified user.
// - verify_jwt=true (supabase/config.toml)
// - Zod-validated input (source ∈ {nav, careerjet, all}, limit ∈ [1,20])
// - Bearer token extracted from Authorization header; reject 401 on missing/empty
// - Visibility rule: scorer MUST be a subset of the user's job-funnel — never
//   include canonical rows that are past live_until just because live_until IS NULL.
//   A canonical is "live" iff it has any ACTIVE source_posting OR live_until > now().
// - AI payload allowlist: title, company, location, work_extent, engagement_type, description_clean
//   (HTML stripped, e-mails + phone redacted, capped at 4000 chars).
// - raw_payload is read server-side ONLY to derive description; it never leaves the server.
// - profileSlim allowlist: NEVER includes name, email, phone, or identifiers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const AI_MODEL = Deno.env.get("SCORE_PENDING_AI_MODEL") ?? "google/gemini-2.5-flash";

const ALLOWED_SOURCES = new Set(["nav", "careerjet", "all"]);
const DESC_MAX_LEN = 4000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Validated = { source: "nav" | "careerjet" | "all"; limit: number };

function validateInput(raw: any): { ok: true; value: Validated } | { ok: false; field: string } {
  const obj = raw && typeof raw === "object" ? raw : {};
  const srcRaw = obj.source ?? "all";
  if (typeof srcRaw !== "string") return { ok: false, field: "source" };
  const src = srcRaw.trim().toLowerCase();
  if (!ALLOWED_SOURCES.has(src)) return { ok: false, field: "source" };
  let lim: number = 20;
  if (obj.limit !== undefined && obj.limit !== null) {
    if (typeof obj.limit !== "number" || !Number.isInteger(obj.limit)) {
      return { ok: false, field: "limit" };
    }
    if (obj.limit < 1 || obj.limit > 20) return { ok: false, field: "limit" };
    lim = obj.limit;
  }
  return { ok: true, value: { source: src as Validated["source"], limit: lim } };
}

function cleanDescription(raw: string | null | undefined): { text: string; redactedEmails: number; redactedPhones: number; length: number } {
  if (!raw || typeof raw !== "string") return { text: "", redactedEmails: 0, redactedPhones: 0, length: 0 };
  let s = raw;
  // Strip HTML tags
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common entities
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  // Redact e-mails
  let redactedEmails = 0;
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => { redactedEmails++; return "[email]"; });
  // Redact phone numbers (loose)
  let redactedPhones = 0;
  s = s.replace(/\+?\d[\d\s().-]{6,}\d/g, () => { redactedPhones++; return "[phone]"; });
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Cap length at word boundary
  if (s.length > DESC_MAX_LEN) {
    const slice = s.slice(0, DESC_MAX_LEN);
    const lastSpace = slice.lastIndexOf(" ");
    s = (lastSpace > DESC_MAX_LEN - 200 ? slice.slice(0, lastSpace) : slice) + "…";
  }
  return { text: s, redactedEmails, redactedPhones, length: s.length };
}

function navDescriptionFromPayload(raw: any): string | null {
  const det = raw?.nav_detail;
  if (!det || typeof det !== "object") return null;
  const ad = det.ad_content?.description;
  const j = det.json?.description;
  if (typeof ad === "string" && ad.trim()) return ad;
  if (typeof j === "string" && j.trim()) return j;
  return null;
}

function careerjetDescriptionFromPayload(raw: any): string | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw.description;
  return typeof d === "string" && d.trim() ? d : null;
}

/** Allowlisted profile slice — NEVER includes name, email, phone, or identifiers. */
function profileSlim(p: any): Record<string, unknown> {
  if (!p || typeof p !== "object") return {};
  return {
    headline: p.headline ?? null,
    years_experience: p.years_experience ?? null,
    target_roles: Array.isArray(p.target_roles) ? p.target_roles : null,
    target_industries: Array.isArray(p.target_industries) ? p.target_industries : null,
    target_seniority: p.target_seniority ?? null,
    industries: Array.isArray(p.industries) ? p.industries : null,
    skills: Array.isArray(p.skills) ? p.skills : null,
    languages: Array.isArray(p.languages) ? p.languages : null,
    preferred_locations: Array.isArray(p.preferred_locations) ? p.preferred_locations : null,
    preferred_work_extents: Array.isArray(p.preferred_work_extents) ? p.preferred_work_extents : [],
    preferred_engagement_types: Array.isArray(p.preferred_engagement_types) ? p.preferred_engagement_types : [],
    willing_to_relocate: !!p.willing_to_relocate,
    salary_expectation_min: p.salary_expectation_min ?? null,
    salary_expectation_max: p.salary_expectation_max ?? null,
    salary_currency: p.salary_currency ?? null,
  };
}

type Candidate = {
  user_opportunity_id: string;
  canonical_opportunity_id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  work_extent: string | null;
  engagement_type: string | null;
  description_clean: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ===== AUTH (Rev 4 fix: extract Bearer token; reject 401 BEFORE service-role) =====
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userRes?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = userRes.user.id;

  // ===== INPUT VALIDATION =====
  let body: any = null;
  try { body = await req.json(); } catch { body = {}; }
  const v = validateInput(body);
  if (!v.ok) return json({ error: "invalid_input", field: v.field }, 400);
  const { source, limit } = v.value;

  // ===== Service role for scoped reads/writes (user verified above) =====
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "server_misconfigured" }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ===== Profile (slim only) =====
  const { data: profileRow } = await admin
    .from("profiles")
    .select("headline, years_experience, target_roles, target_industries, target_seniority, industries, skills, languages, preferred_locations, preferred_work_extents, preferred_engagement_types, willing_to_relocate, salary_expectation_min, salary_expectation_max, salary_currency")
    .eq("id", userId)
    .maybeSingle();
  if (!profileRow) return json({ error: "profile_not_found" }, 403);
  const profile_slim = profileSlim(profileRow);

  // ===== Select candidates =====
  // Visibility rule (Rev 4): canonical is visible iff has an ACTIVE source_posting OR live_until > now().
  // Subset of list_user_job_opportunities.
  const sourceFilterSql = source === "all" ? null : source;

  const { data: pending, error: pendingErr } = await admin
    .from("user_opportunities")
    .select("id, canonical_opportunity_id, card_title, card_company, card_location, card_source, canonical_opportunities!inner(id, live_until)")
    .eq("user_id", userId)
    .is("ai_scored_at", null)
    .in("status", ["new", "saved"])
    .limit(limit * 4); // overfetch; filter visibility below
  if (pendingErr) return json({ error: "select_failed" }, 500);

  // Filter visibility + source
  const now = new Date();
  const filtered: any[] = [];
  for (const row of pending ?? []) {
    if (sourceFilterSql && row.card_source !== sourceFilterSql) continue;
    const co = (row as any).canonical_opportunities;
    const liveUntil = co?.live_until ? new Date(co.live_until) : null;

    // Check if canonical has any ACTIVE source_posting
    const { data: activeLinks } = await admin
      .from("opportunity_source_links")
      .select("source_postings!inner(posting_status)")
      .eq("canonical_opportunity_id", row.canonical_opportunity_id);
    const hasActive = (activeLinks ?? []).some(
      (l: any) => l.source_postings?.posting_status === "active",
    );
    const liveByUntil = liveUntil != null && liveUntil > now;
    if (!hasActive && !liveByUntil) continue;

    filtered.push(row);
    if (filtered.length >= limit) break;
  }

  const selected_ids = filtered.map((r: any) => r.id);
  if (selected_ids.length === 0) {
    return json({ selected: 0, scored: 0, failed: 0, source, limit });
  }

  // Fetch primary source_postings (server-side raw_payload read for description ONLY)
  const canonIds = filtered.map((r: any) => r.canonical_opportunity_id);
  const { data: links } = await admin
    .from("opportunity_source_links")
    .select("canonical_opportunity_id, link_role, source_postings(id, source, work_extent, engagement_type, raw_payload)")
    .in("canonical_opportunity_id", canonIds)
    .eq("link_role", "primary");

  const byCanon = new Map<string, any>();
  for (const l of links ?? []) {
    if (!byCanon.has((l as any).canonical_opportunity_id)) {
      byCanon.set((l as any).canonical_opportunity_id, (l as any).source_postings);
    }
  }

  let totalRedactedEmails = 0;
  let totalRedactedPhones = 0;
  const candidates: Candidate[] = [];

  for (const r of filtered) {
    const sp = byCanon.get((r as any).canonical_opportunity_id) ?? null;
    let descRaw: string | null = null;
    if (sp?.source === "nav") descRaw = navDescriptionFromPayload(sp?.raw_payload);
    else if (sp?.source === "careerjet") descRaw = careerjetDescriptionFromPayload(sp?.raw_payload);
    const cleaned = cleanDescription(descRaw);
    totalRedactedEmails += cleaned.redactedEmails;
    totalRedactedPhones += cleaned.redactedPhones;
    candidates.push({
      user_opportunity_id: (r as any).id,
      canonical_opportunity_id: (r as any).canonical_opportunity_id,
      title: (r as any).card_title ?? null,
      company: (r as any).card_company ?? null,
      location: (r as any).card_location ?? null,
      work_extent: sp?.work_extent ?? null,
      engagement_type: sp?.engagement_type ?? null,
      description_clean: cleaned.text,
    });
  }

  // ===== AI batch call (single request) =====
  let scored = 0;
  let failed = 0;
  let aiError: string | null = null;

  if (!LOVABLE_API_KEY) {
    return json({ error: "ai_key_missing" }, 500);
  }

  // AI payload (allowlisted)
  const aiCandidates = candidates.map((c) => ({
    id: c.user_opportunity_id,
    title: c.title,
    company: c.company,
    location: c.location,
    work_extent: c.work_extent,
    engagement_type: c.engagement_type,
    description: c.description_clean,
  }));

  const systemPrompt = `Du vurderer jobbmatch på en skala 0-100 basert på brukerens karriereprofil og stillingsannonsen. Svar med ren JSON: {"results":[{"id":"<uuid>","score":N,"reasoning":"...","match_highlights":"...","concerns":"..."}]}. Inkluder ALLE id-er du fikk. Maks 280 tegn per tekstfelt. Score 0 er gyldig.`;

  const userMessage = JSON.stringify({ profile: profile_slim, jobs: aiCandidates });

  let aiResults: any[] = [];
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
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`ai gateway ${res.status}`);
    const data = await res.json();
    const txt = String(data?.choices?.[0]?.message?.content ?? "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("ai response not json");
    const parsed = JSON.parse(m[0]);
    aiResults = Array.isArray(parsed.results) ? parsed.results : [];
  } catch (e: any) {
    aiError = "ai_failed";
  }

  if (aiError) {
    return json({ selected: selected_ids.length, scored: 0, failed: selected_ids.length, error: aiError });
  }

  const selectedSet = new Set(selected_ids);
  for (const r of aiResults) {
    const id = typeof r?.id === "string" ? r.id : null;
    if (!id || !selectedSet.has(id)) continue;
    const score = Math.max(0, Math.min(100, Number(r.score) || 0));
    const reasoning = String(r.reasoning ?? "").slice(0, 1000);
    const highlights = String(r.match_highlights ?? "").slice(0, 1000);
    const concerns = String(r.concerns ?? "").slice(0, 1000);
    const { error: updErr } = await admin
      .from("user_opportunities")
      .update({
        ai_score: score,
        ai_reasoning: reasoning || null,
        ai_match_highlights: highlights || null,
        ai_concerns: concerns || null,
        ai_scored_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);
    if (updErr) { failed++; continue; }
    scored++;
  }
  failed += selected_ids.length - scored;

  return json({
    selected: selected_ids.length,
    scored,
    failed,
    source,
    limit,
    redacted_emails: totalRedactedEmails,
    redacted_phones: totalRedactedPhones,
  });
});
