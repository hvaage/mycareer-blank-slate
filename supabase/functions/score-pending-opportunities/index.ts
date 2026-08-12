// Job Match V2
// Hard eligibility screening runs before scoring. Mandatory requirements may
// only be treated as met when the model cites both the job text and a known
// evidence reference. Every committed replacement is written atomically with
// its previous value through record_job_match_evaluation().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type AiEvaluation,
  type EvidenceItem,
  type FinalEvaluation,
  finalizeEvaluation,
  initialScreening,
  MATCH_SCORE_VERSION,
  type ScreeningJob,
  type ScreeningProfile,
} from "./screening-v2.ts";
import {
  logPreflightFailure,
  preflight,
  preflightFailureBody,
} from "../_shared/preflight.ts";

const FN = "score-pending-opportunities";

// Alle fire variablene er nødvendige for reelt arbeid. Funksjonen har ingen
// kjøringstabell, så preflight-feil rapporteres med logged: false.
const PREFLIGHT_SPEC = {
  logging: [] as string[],
  work: [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "LOVABLE_API_KEY",
  ],
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const AI_MODEL = Deno.env.get("SCORE_PENDING_AI_MODEL") ??
  "google/gemini-2.5-flash";


const ALLOWED_SOURCES = new Set(["nav", "careerjet", "all"]);
const ALLOWED_MODES = new Set(["pending", "stale", "rescore"]);
const DESC_MAX_LEN = 6000;
const EVIDENCE_LIMIT = 80;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Validated = {
  source: "nav" | "careerjet" | "all";
  mode: "pending" | "stale" | "rescore";
  limit: number;
  dry_run: boolean;
  user_opportunity_ids: string[];
  listing_status_ids: string[];
};

function validateIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const result = raw.filter((value): value is string =>
    typeof value === "string"
  );
  if (
    result.length !== raw.length || result.some((value) => !UUID_RE.test(value))
  ) return null;
  return [...new Set(result)];
}

function validateInput(
  raw: unknown,
): { ok: true; value: Validated } | { ok: false; field: string } {
  const obj = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const source = typeof obj.source === "string"
    ? obj.source.trim().toLowerCase()
    : "all";
  const mode = typeof obj.mode === "string"
    ? obj.mode.trim().toLowerCase()
    : "stale";
  if (!ALLOWED_SOURCES.has(source)) return { ok: false, field: "source" };
  if (!ALLOWED_MODES.has(mode)) return { ok: false, field: "mode" };

  let limit = 20;
  if (obj.limit !== undefined && obj.limit !== null) {
    if (
      typeof obj.limit !== "number" || !Number.isInteger(obj.limit) ||
      obj.limit < 1 || obj.limit > 20
    ) {
      return { ok: false, field: "limit" };
    }
    limit = obj.limit;
  }
  if (obj.dry_run !== undefined && typeof obj.dry_run !== "boolean") {
    return { ok: false, field: "dry_run" };
  }
  const userOpportunityIds = validateIds(obj.user_opportunity_ids);
  const listingStatusIds = validateIds(obj.listing_status_ids);
  if (userOpportunityIds === null) {
    return { ok: false, field: "user_opportunity_ids" };
  }
  if (listingStatusIds === null) {
    return { ok: false, field: "listing_status_ids" };
  }
  if (userOpportunityIds.length + listingStatusIds.length > 20) {
    return { ok: false, field: "ids" };
  }
  return {
    ok: true,
    value: {
      source: source as Validated["source"],
      mode: mode as Validated["mode"],
      limit,
      dry_run: obj.dry_run === true,
      user_opportunity_ids: userOpportunityIds,
      listing_status_ids: listingStatusIds,
    },
  };
}

function cleanText(raw: unknown, max = 1000): string {
  if (typeof raw !== "string") return "";
  let value = raw.replace(/<[^>]+>/g, " ");
  value = value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  value = value.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[email]",
  );
  value = value.replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]");
  value = value.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const boundary = slice.lastIndexOf(" ");
  return `${boundary > max - 200 ? slice.slice(0, boundary) : slice}…`;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function relation(value: unknown): any {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function navDescription(raw: unknown): string | null {
  const payload = asObject(raw);
  const detail = asObject(payload.nav_detail);
  const candidates = [
    asObject(detail.ad_content).description,
    asObject(detail.json).description,
    detail.description,
  ];
  return candidates.find((value) =>
    typeof value === "string" && value.trim()
  ) ?? null;
}

function careerjetDescription(raw: unknown): string | null {
  const payload = asObject(raw);
  const candidates = [
    payload.description,
    asObject(payload.job).description,
    asObject(payload.result).description,
    asObject(payload.raw_data).description,
  ];
  return candidates.find((value) =>
    typeof value === "string" && value.trim()
  ) ?? null;
}

type SourcePosting = {
  id: string;
  source: string;
  listing_id: string | null;
  posting_status: string;
  identity_role: string | null;
  identity_superseded_by_source_posting_id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  description_excerpt: string | null;
  raw_payload: unknown;
  work_extent: string | null;
  engagement_type: string | null;
};

type Candidate = {
  row_kind: "canonical" | "legacy";
  row_id: string;
  user_opportunity_id: string | null;
  listing_status_id: string | null;
  canonical_opportunity_id: string | null;
  listing_id: string | null;
  source: "nav" | "careerjet";
  title: string | null;
  company: string | null;
  location: string | null;
  work_type: string | null;
  work_extent: string | null;
  engagement_type: string | null;
  description: string;
  description_complete: boolean;
  current: Record<string, unknown>;
};

function sourcePostingVisible(posting: SourcePosting): boolean {
  return posting.source !== "careerjet" ||
    (posting.identity_role !== "superseded" &&
      !posting.identity_superseded_by_source_posting_id);
}

function modeMatches(row: any, mode: Validated["mode"]): boolean {
  if (mode === "rescore") return true;
  if (mode === "pending") return !row.ai_scored_at;
  return !row.match_score_version ||
    row.match_score_version !== MATCH_SCORE_VERSION;
}

async function legacyCareerjetDescription(
  admin: any,
  posting: SourcePosting | null,
  title: string | null,
  company: string | null,
  location: string | null,
): Promise<string | null> {
  if (posting?.listing_id) {
    const { data } = await admin
      .from("job_listings")
      .select("description")
      .eq("id", posting.listing_id)
      .maybeSingle();
    if (typeof data?.description === "string" && data.description.trim()) {
      return data.description;
    }
  }
  if (!title || !company) return null;
  let query = admin
    .from("job_listings")
    .select("description, location, updated_at")
    .eq("source", "careerjet")
    .eq("title", title)
    .eq("employer", company)
    .not("description", "is", null)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(8);
  const { data } = await query;
  const rows = Array.isArray(data) ? data : [];
  const exact = rows.find((row: any) =>
    location && row.location === location && row.description
  );
  const best = exact ?? rows
    .filter((row: any) => typeof row.description === "string")
    .sort((a: any, b: any) => b.description.length - a.description.length)[0];
  return typeof best?.description === "string" ? best.description : null;
}

function currentResult(row: any): Record<string, unknown> {
  return {
    screening_status: row.screening_status ?? null,
    screening_reasons: row.screening_reasons ?? [],
    requirement_summary: row.requirement_summary ?? {},
    match_score_version: row.match_score_version ?? null,
    match_scored_model: row.match_scored_model ?? null,
    ai_score: row.ai_score ?? null,
    ai_reasoning: row.ai_reasoning ?? null,
    ai_match_highlights: row.ai_match_highlights ?? null,
    ai_concerns: row.ai_concerns ?? null,
    ai_scored_at: row.ai_scored_at ?? null,
  };
}

async function loadCandidates(
  admin: any,
  userId: string,
  input: Validated,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const now = Date.now();
  const targeted =
    input.user_opportunity_ids.length + input.listing_status_ids.length > 0;
  if (!targeted || input.user_opportunity_ids.length > 0) {
    let canonicalQuery = admin
      .from("user_opportunities")
      .select(
        "id, canonical_opportunity_id, legacy_listing_id, legacy_listing_status_id, card_title, card_company, card_location, card_source, status, ai_score, ai_scored_at, ai_reasoning, ai_match_highlights, ai_concerns, screening_status, screening_reasons, requirement_summary, match_score_version, match_scored_model, canonical_opportunities!inner(id, live_until)",
      )
      .eq("user_id", userId)
      .in("status", ["new", "saved"])
      .limit(200);
    if (input.user_opportunity_ids.length > 0) {
      canonicalQuery = canonicalQuery.in("id", input.user_opportunity_ids);
    }
    const { data: canonicalRows, error: canonicalError } = await canonicalQuery;
    if (canonicalError) {
      throw new Error(`canonical_select_failed:${canonicalError.message}`);
    }

    const filteredRows = (canonicalRows ?? []).filter((row: any) =>
      modeMatches(row, input.mode)
    );
    const canonicalIds = [
      ...new Set(filteredRows.map((row: any) => row.canonical_opportunity_id)),
    ];
    const linksByCanonical = new Map<
      string,
      Array<{ link_role: string; posting: SourcePosting }>
    >();
    if (canonicalIds.length > 0) {
      const { data: links, error: linksError } = await admin
        .from("opportunity_source_links")
        .select(
          "canonical_opportunity_id, link_role, source_postings!inner(id, source, listing_id, posting_status, identity_role, identity_superseded_by_source_posting_id, title, company, location, description_excerpt, raw_payload, work_extent, engagement_type)",
        )
        .in("canonical_opportunity_id", canonicalIds);
      if (linksError) {
        throw new Error(`source_select_failed:${linksError.message}`);
      }
      for (const link of links ?? []) {
        const posting = relation((link as any).source_postings) as
          | SourcePosting
          | null;
        if (!posting || !sourcePostingVisible(posting)) continue;
        const list =
          linksByCanonical.get((link as any).canonical_opportunity_id) ?? [];
        list.push({
          link_role: String((link as any).link_role ?? "variant"),
          posting,
        });
        linksByCanonical.set((link as any).canonical_opportunity_id, list);
      }
    }

    for (const row of filteredRows) {
      if (candidates.length >= input.limit) break;
      const links =
        linksByCanonical.get((row as any).canonical_opportunity_id) ?? [];
      const sourceLinks = input.source === "all"
        ? links
        : links.filter((item) => item.posting.source === input.source);
      if (sourceLinks.length === 0) continue;
      const canonical = relation((row as any).canonical_opportunities);
      const liveUntil = canonical?.live_until
        ? new Date(canonical.live_until).getTime()
        : 0;
      const hasActive = sourceLinks.some((item) =>
        item.posting.posting_status === "active"
      );
      if (!hasActive && !(liveUntil > now)) continue;

      const preferredSource = (row as any).card_source;
      const ranked = [...sourceLinks].sort((a, b) => {
        const aRaw = a.posting.source === "nav"
          ? navDescription(a.posting.raw_payload)
          : careerjetDescription(a.posting.raw_payload);
        const bRaw = b.posting.source === "nav"
          ? navDescription(b.posting.raw_payload)
          : careerjetDescription(b.posting.raw_payload);
        const aRank = (a.posting.posting_status === "active" ? 1000000 : 0) +
          (a.posting.source === preferredSource ? 100000 : 0) +
          (a.link_role === "primary" ? 1000 : 0) +
          (aRaw?.length ?? a.posting.description_excerpt?.length ?? 0);
        const bRank = (b.posting.posting_status === "active" ? 1000000 : 0) +
          (b.posting.source === preferredSource ? 100000 : 0) +
          (b.link_role === "primary" ? 1000 : 0) +
          (bRaw?.length ?? b.posting.description_excerpt?.length ?? 0);
        return bRank - aRank;
      });
      const selected = ranked[0]?.posting ?? null;
      const source =
        (selected?.source === "nav" ? "nav" : "careerjet") as Candidate[
          "source"
        ];
      let descriptionRaw = source === "nav"
        ? navDescription(selected?.raw_payload)
        : careerjetDescription(selected?.raw_payload);
      let descriptionComplete = !!descriptionRaw;
      if (!descriptionRaw && source === "careerjet") {
        descriptionRaw = await legacyCareerjetDescription(
          admin,
          selected,
          (row as any).card_title,
          (row as any).card_company,
          (row as any).card_location,
        );
        descriptionComplete = !!descriptionRaw;
      }
      if (!descriptionRaw && selected?.description_excerpt) {
        descriptionRaw = selected.description_excerpt;
        descriptionComplete = false;
      }
      candidates.push({
        row_kind: "canonical",
        row_id: (row as any).id,
        user_opportunity_id: (row as any).id,
        listing_status_id: (row as any).legacy_listing_status_id ?? null,
        canonical_opportunity_id: (row as any).canonical_opportunity_id,
        listing_id: (row as any).legacy_listing_id ?? selected?.listing_id ??
          null,
        source,
        title: (row as any).card_title ?? selected?.title ?? null,
        company: (row as any).card_company ?? selected?.company ?? null,
        location: (row as any).card_location ?? selected?.location ?? null,
        work_type: null,
        work_extent: selected?.work_extent ?? null,
        engagement_type: selected?.engagement_type ?? null,
        description: cleanText(descriptionRaw, DESC_MAX_LEN),
        description_complete: descriptionComplete,
        current: currentResult(row),
      });
    }
  }

  if (
    candidates.length >= input.limit || input.source === "nav" ||
    (targeted && input.listing_status_ids.length === 0)
  ) {
    return candidates;
  }
  const representedStatusIds = new Set<string>();
  const { data: represented } = await admin
    .from("user_opportunities")
    .select("legacy_listing_status_id")
    .eq("user_id", userId)
    .not("legacy_listing_status_id", "is", null);
  for (const row of represented ?? []) {
    if ((row as any).legacy_listing_status_id) {
      representedStatusIds.add((row as any).legacy_listing_status_id);
    }
  }

  let legacyQuery = admin
    .from("user_job_listing_status")
    .select(
      "id, listing_id, status, ai_score, ai_scored_at, ai_reasoning, ai_match_highlights, ai_concerns, screening_status, screening_reasons, requirement_summary, match_score_version, match_scored_model, job_listings!inner(id, source, title, employer, location, description, is_expired, expires_at)",
    )
    .eq("user_id", userId)
    .in("status", ["new", "saved"])
    .eq("job_listings.source", "careerjet")
    .limit(200);
  if (input.listing_status_ids.length > 0) {
    legacyQuery = legacyQuery.in("id", input.listing_status_ids);
  }
  const { data: legacyRows, error: legacyError } = await legacyQuery;
  if (legacyError) {
    throw new Error(`legacy_select_failed:${legacyError.message}`);
  }
  for (const row of legacyRows ?? []) {
    if (candidates.length >= input.limit) break;
    if (
      representedStatusIds.has((row as any).id) || !modeMatches(row, input.mode)
    ) continue;
    const listing = relation((row as any).job_listings);
    if (!listing || listing.is_expired === true) continue;
    if (listing.expires_at && new Date(listing.expires_at).getTime() <= now) {
      continue;
    }
    const description = cleanText(listing.description, DESC_MAX_LEN);
    candidates.push({
      row_kind: "legacy",
      row_id: (row as any).id,
      user_opportunity_id: null,
      listing_status_id: (row as any).id,
      canonical_opportunity_id: null,
      listing_id: (row as any).listing_id,
      source: "careerjet",
      title: listing.title ?? null,
      company: listing.employer ?? null,
      location: listing.location ?? null,
      work_type: null,
      work_extent: null,
      engagement_type: null,
      description,
      description_complete: !!description,
      current: currentResult(row),
    });
  }
  return candidates;
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0
      ).map((value) => value.trim()),
    ),
  ];
}

async function loadProfileAndEvidence(admin: any, userId: string): Promise<{
  profile: ScreeningProfile;
  profileAi: Record<string, unknown>;
  evidence: EvidenceItem[];
}> {
  const [profileResult, careerResult, evidenceResult, cvResult] = await Promise
    .all([
      admin.from("profiles")
        .select(
          "headline, years_experience, target_role, target_roles, target_seniority, target_industries, industries, skills, languages, preferred_locations, target_city, target_region, target_country, preferred_work_extents, preferred_engagement_types, willing_to_relocate, work_types",
        )
        .eq("id", userId).maybeSingle(),
      admin.from("user_career_profiles")
        .select(
          "career_stage, leadership_level, years_experience, desired_role_types, desired_industries, preferred_locations, preferred_work_styles, remote_preference",
        )
        .eq("user_id", userId).maybeSingle(),
      admin.from("user_evidence_atoms")
        .select(
          "id, category, label, description, evidence_type, strength_score, confidence_score",
        )
        .eq("user_id", userId).eq("is_active", true)
        .order("strength_score", { ascending: false, nullsFirst: false }).limit(
          EVIDENCE_LIMIT,
        ),
      admin.from("cv_evidence_atoms")
        .select(
          "id, atom_type, content_no, content_en, source_quote, structured_data, confidence, user_confirmed, relevance_score",
        )
        .eq("user_id", userId)
        .order("user_confirmed", { ascending: false })
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(EVIDENCE_LIMIT),
    ]);
  if (profileResult.error || !profileResult.data) {
    throw new Error("profile_not_found");
  }
  if (careerResult.error) {
    throw new Error(
      `career_profile_select_failed:${careerResult.error.message}`,
    );
  }
  if (evidenceResult.error) {
    throw new Error(`evidence_select_failed:${evidenceResult.error.message}`);
  }
  if (cvResult.error) {
    throw new Error(`cv_evidence_select_failed:${cvResult.error.message}`);
  }
  const p = profileResult.data;
  const c = careerResult.data ?? {};
  const targetRoles = uniqueStrings([
    ...(Array.isArray(p.target_roles) ? p.target_roles : []),
    p.target_role,
    ...(Array.isArray(c.desired_role_types) ? c.desired_role_types : []),
  ]);
  const preferredLocations = uniqueStrings([
    ...(Array.isArray(p.preferred_locations) ? p.preferred_locations : []),
    ...(Array.isArray(c.preferred_locations) ? c.preferred_locations : []),
  ]);

  const evidence: EvidenceItem[] = [];
  for (const item of evidenceResult.data ?? []) {
    evidence.push({
      ref: `ue:${item.id}`,
      category: cleanText(item.category, 80),
      label: cleanText(item.label, 240),
      description: cleanText(item.description, 500) || null,
    });
  }
  for (const item of cvResult.data ?? []) {
    const content = cleanText(
      item.content_no || item.content_en || item.source_quote,
      500,
    );
    if (!content) continue;
    evidence.push({
      ref: `cv:${item.id}`,
      category: cleanText(item.atom_type, 80),
      label: content.slice(0, 240),
      description: cleanText(item.source_quote, 500) || null,
    });
  }

  return {
    profile: {
      target_roles: targetRoles,
      preferred_locations: preferredLocations,
      target_city: p.target_city ?? null,
      target_region: p.target_region ?? null,
      willing_to_relocate: p.willing_to_relocate === true,
      preferred_work_extents: Array.isArray(p.preferred_work_extents)
        ? p.preferred_work_extents
        : [],
      preferred_engagement_types: Array.isArray(p.preferred_engagement_types)
        ? p.preferred_engagement_types
        : [],
    },
    profileAi: {
      headline: cleanText(p.headline, 300) || null,
      years_experience: p.years_experience ?? c.years_experience ?? null,
      target_roles: targetRoles,
      target_seniority: p.target_seniority ?? c.leadership_level ?? null,
      target_industries: uniqueStrings([
        ...(Array.isArray(p.target_industries) ? p.target_industries : []),
        ...(Array.isArray(c.desired_industries) ? c.desired_industries : []),
      ]),
      industries: Array.isArray(p.industries) ? p.industries : [],
      skills: Array.isArray(p.skills)
        ? p.skills.map((value: unknown) => cleanText(value, 120)).filter(
          Boolean,
        )
        : [],
      languages: Array.isArray(p.languages)
        ? p.languages.map((value: unknown) => cleanText(value, 120)).filter(
          Boolean,
        )
        : [],
      career_stage: c.career_stage ?? null,
      leadership_level: c.leadership_level ?? null,
    },
    evidence: evidence.slice(0, EVIDENCE_LIMIT),
  };
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) =>
    part.toString(16).padStart(2, "0")
  ).join("");
}

function requirementSummary(result: FinalEvaluation): Record<string, unknown> {
  const mandatory = result.requirements.filter((item) =>
    item.level === "mandatory"
  );
  return {
    parser_version: MATCH_SCORE_VERSION,
    mandatory_total: mandatory.length,
    mandatory_met:
      mandatory.filter((item) =>
        item.met === true && item.matched_evidence_refs.length > 0
      ).length,
    mandatory_missing:
      mandatory.filter((item) =>
        item.met === false || item.matched_evidence_refs.length === 0
      ).length,
    requirements: result.requirements,
  };
}

async function callAi(
  profileAi: Record<string, unknown>,
  evidence: EvidenceItem[],
  candidates: Candidate[],
): Promise<Map<string, AiEvaluation>> {
  if (candidates.length === 0) return new Map();
  if (!LOVABLE_API_KEY) throw new Error("ai_key_missing");
  const jobs = candidates.map((candidate) => ({
    id: candidate.row_id,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    work_extent: candidate.work_extent,
    engagement_type: candidate.engagement_type,
    description: candidate.description,
  }));
  const systemPrompt = `Du er en streng kvalifikasjons- og jobbmatchmotor.

Svar KUN med gyldig JSON i denne formen:
{"results":[{"id":"uuid","score":0,"reasoning":"...","match_highlights":"...","concerns":"...","requirements":[{"type":"education|license|certification|language|experience|skill|other","level":"mandatory|preferred|context","label":"...","evidence_quote":"ordrett sitat fra annonsen","met":true|false|null,"matched_evidence_refs":["ue:uuid|cv:uuid"]}]}]}

Regler:
1. Inkluder nøyaktig én rad for hver mottatt jobb-id.
2. Lokasjon er allerede kontrollert som en port. Lokasjon gir ALDRI poeng og skal ikke nevnes som match_highlight.
3. En målrolle må være selve stillingstittelen. At stillingen rapporterer til eller samarbeider med COO/CPO/CCO er ALDRI en rollematch.
4. Trekk ut alle uttrykkelige obligatoriske og foretrukne krav. Hvert krav må ha et ordrett sitat fra annonseteksten.
5. Brukeren oppfyller et krav bare når matched_evidence_refs peker på en av de oppgitte evidensradene. Ikke anta grad, autorisasjon, sertifikat, språk, bransje eller erfaring.
6. Obligatorisk utdanning, autorisasjon eller sertifikat uten dokumentert evidens skal ha met=false.
7. Score gjelder bare faglig/erfaringsmessig samsvar blant kvalifiserte kandidater. 100 krever svært sterk, dokumentert dekning. Ikke belønn nøkkelord alene.
8. Maks 450 tegn i hvert tekstfelt. Score må være et endelig tall 0-100.`;
  const response = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({ profile: profileAi, evidence, jobs }),
          },
        ],
        temperature: 0.1,
      }),
    },
  );
  if (!response.ok) throw new Error(`ai_gateway_${response.status}`);
  const payload = await response.json();
  const content = String(payload?.choices?.[0]?.message?.content ?? "");
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("ai_response_not_json");
  const parsed = JSON.parse(match[0]);
  const allowed = new Set(candidates.map((candidate) => candidate.row_id));
  const results = new Map<string, AiEvaluation>();
  for (const raw of Array.isArray(parsed.results) ? parsed.results : []) {
    if (
      !raw || typeof raw.id !== "string" || !allowed.has(raw.id) ||
      results.has(raw.id)
    ) continue;
    results.set(raw.id, raw as AiEvaluation);
  }
  return results;
}

async function syncRequirementAtoms(
  admin: any,
  candidate: Candidate,
  result: FinalEvaluation,
): Promise<void> {
  const scopeColumn = candidate.canonical_opportunity_id
    ? "opportunity_id"
    : "listing_id";
  const scopeId = candidate.canonical_opportunity_id ?? candidate.listing_id;
  if (!scopeId) return;
  await admin
    .from("opportunity_requirement_atoms")
    .update({
      is_active: false,
      stale_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq(scopeColumn, scopeId)
    .eq("parser_version", MATCH_SCORE_VERSION)
    .eq("is_active", true);

  for (const requirement of result.requirements) {
    const sourceHash = await sha256({
      parser: MATCH_SCORE_VERSION,
      scope: scopeId,
      type: requirement.type,
      level: requirement.level,
      label: requirement.label,
      quote: requirement.evidence_quote,
    });
    const { data: existing } = await admin
      .from("opportunity_requirement_atoms")
      .select("id")
      .eq(scopeColumn, scopeId)
      .eq("source_hash", sourceHash)
      .limit(1)
      .maybeSingle();
    const values = {
      category: requirement.type,
      dimension: "qualification",
      label: requirement.label,
      normalized_value: requirement.label.toLowerCase(),
      description: requirement.evidence_quote,
      importance_score: requirement.level === "mandatory"
        ? 6
        : requirement.level === "preferred"
        ? 4
        : 2,
      confidence_score: 1,
      source: "job_match_v2",
      source_field: "full_description",
      source_hash: sourceHash,
      inferred: false,
      is_active: true,
      refreshed_at: new Date().toISOString(),
      stale_at: null,
      requirement_level: requirement.level,
      evidence_excerpt: requirement.evidence_quote,
      parser_version: MATCH_SCORE_VERSION,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id) {
      const { error } = await admin.from("opportunity_requirement_atoms")
        .update(values).eq("id", existing.id);
      if (error) throw new Error(`requirement_update_failed:${error.message}`);
    } else {
      const insert = {
        ...values,
        opportunity_id: candidate.canonical_opportunity_id,
        listing_id: candidate.canonical_opportunity_id
          ? null
          : candidate.listing_id,
      };
      const { error } = await admin.from("opportunity_requirement_atoms")
        .insert(insert);
      if (error) throw new Error(`requirement_insert_failed:${error.message}`);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ status: "failed", error: "method_not_allowed" }, 405);
  }

  // --- PREFLIGHT ---
  // Manglende konfigurasjon skal feile ved oppstart, ikke gi et tomt,
  // tilsynelatende vellykket resultat. Funksjonen har ingen kjøringstabell,
  // så vi merker svaret eksplisitt med logged: false.
  const pf = preflight(PREFLIGHT_SPEC);
  if (!pf.ok) {
    logPreflightFailure(FN, pf);
    return json(
      { ...preflightFailureBody(FN, pf, { logged: false, log_error: "no run table for this function" }), status: "failed" },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ??
    req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ status: "failed", error: "unauthorized" }, 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) return json({ status: "failed", error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser(
    token,
  );
  if (userError || !userResult?.user?.id) {
    return json({ status: "failed", error: "unauthorized" }, 401);
  }
  const userId = userResult.user.id;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch (error) {
    // Tom kropp er lovlig, men årsaken skal aldri forsvinne.
    console.warn(
      `[${FN}] request body not JSON, using defaults`,
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    body = {};
  }
  const validated = validateInput(body);
  if (!validated.ok) {
    return json({ status: "failed", error: "invalid_input", field: validated.field }, 400);
  }

  const input = validated.value;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const candidates = await loadCandidates(admin, userId, input);
    if (candidates.length === 0) {
      // Tomt utvalg er et gyldig utfall, men det er ikke "ok" — det skilles ut
      // som empty slik at konsumenter ikke tolker null arbeid som vellykket.
      return json({
        status: "empty",
        ok: false,
        score_version: MATCH_SCORE_VERSION,
        selected: 0,
        evaluated: 0,
        committed: 0,
        failed: 0,
        dry_run: input.dry_run,
        source: input.source,
        mode: input.mode,
      });
    }

    const { profile, profileAi, evidence } = await loadProfileAndEvidence(
      admin,
      userId,
    );
    const initialById = new Map(candidates.map((candidate) => [
      candidate.row_id,
      initialScreening(
        {
          title: candidate.title,
          location: candidate.location,
          work_type: candidate.work_type,
          work_extent: candidate.work_extent,
          engagement_type: candidate.engagement_type,
          description: candidate.description,
          description_complete: candidate.description_complete,
        } satisfies ScreeningJob,
        profile,
        evidence,
      ),
    ]));
    const aiCandidates = candidates.filter((candidate) =>
      initialById.get(candidate.row_id)?.status === "eligible"
    );
    let aiResults = new Map<string, AiEvaluation>();
    if (aiCandidates.length > 0) {
      aiResults = await callAi(profileAi, evidence, aiCandidates);
    }
    const profileInputHash = await sha256({ profile, profileAi, evidence });

    const resultRows: Array<Record<string, unknown>> = [];
    const failures: Array<{ id: string; error: string }> = [];
    let committed = 0;
    for (const candidate of candidates) {
      const initial = initialById.get(candidate.row_id)!;
      const requiresAi = initial.status === "eligible";
      const aiResult = requiresAi ? aiResults.get(candidate.row_id) : {
        id: candidate.row_id,
        score: 0,
        reasoning: "",
        match_highlights: "",
        concerns: "",
        requirements: [],
      };
      if (!aiResult) {
        failures.push({
          id: candidate.row_id,
          error: "missing_in_ai_response",
        });
        continue;
      }
      const final = finalizeEvaluation(
        initial,
        aiResult,
        candidate.description,
        evidence,
      );
      if (final.status !== "eligible" && !final.reasoning) {
        final.reasoning = final.reasons.map((reason) => reason.label).join(" ")
          .slice(0, 1000);
      }
      if (final.status !== "eligible") {
        final.match_highlights = "";
        final.concerns = final.reasons.map((reason) => reason.label).join(" ")
          .slice(0, 1000);
      }
      const summary = requirementSummary(final);
      const jobInputHash = await sha256({
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        work_extent: candidate.work_extent,
        engagement_type: candidate.engagement_type,
        description: candidate.description,
        description_complete: candidate.description_complete,
      });
      const resultPayload = {
        screening_status: final.status,
        screening_reasons: final.reasons,
        requirement_summary: summary,
        score: final.score,
        reasoning: final.reasoning,
        match_highlights: final.match_highlights,
        concerns: final.concerns,
      };
      try {
        if (!input.dry_run) {
          const model = requiresAi ? AI_MODEL : "deterministic_gate_v2";
          const { error: recordError } = await admin.rpc(
            "record_job_match_evaluation",
            {
              p_user_id: userId,
              p_row_kind: candidate.row_kind,
              p_row_id: candidate.row_id,
              p_result: resultPayload,
              p_score_version: MATCH_SCORE_VERSION,
              p_model: model,
              p_profile_input_hash: profileInputHash,
              p_job_input_hash: jobInputHash,
            },
          );
          if (recordError) {
            throw new Error(`record_failed:${recordError.message}`);
          }
          await syncRequirementAtoms(admin, candidate, final);
          committed++;
        }
        resultRows.push({
          id: candidate.row_id,
          row_kind: candidate.row_kind,
          source: candidate.source,
          title: candidate.title,
          screening_status: final.status,
          score: final.score,
          reason_codes: final.reasons.map((reason) => reason.code),
          mandatory_requirements: final.requirements.filter((item) =>
            item.level === "mandatory"
          ).length,
          description_complete: candidate.description_complete,
          previous_score: candidate.current.ai_score ?? null,
          previous_score_version: candidate.current.match_score_version ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "write_failed";
        console.error(
          `[${FN}] evaluation write failed`,
          JSON.stringify({ row_id: candidate.row_id, row_kind: candidate.row_kind, error: message }),
        );
        failures.push({ id: candidate.row_id, error: message.slice(0, 240) });
      }
    }

    const statusCounts = resultRows.reduce<Record<string, number>>(
      (acc, row) => {
        const status = String(row.screening_status);
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      },
      {},
    );
    // ok/partial/failed/empty: delvise feil skal telles og rapporteres, ikke
    // pakkes inn i et 200-svar som ser komplett ut.
    const resultStatus: "ok" | "empty" | "partial" | "failed" =
      failures.length === 0
        ? (resultRows.length === 0 ? "empty" : "ok")
        : (resultRows.length === 0 ? "failed" : "partial");
    return json({
      status: resultStatus,
      ok: resultStatus === "ok",
      score_version: MATCH_SCORE_VERSION,
      selected: candidates.length,
      evaluated: resultRows.length,
      committed,
      failed: failures.length,
      dry_run: input.dry_run,
      source: input.source,
      mode: input.mode,
      status_counts: statusCounts,
      evidence_items_used: evidence.length,
      results: resultRows,
      failures,
    }, resultStatus === "failed" ? 500 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "profile_not_found" ? 403 : 500;
    console.error(`[${FN}] run failed`, JSON.stringify({ user_id: userId, error: message }));
    return json({
      status: "failed",
      ok: false,
      error: message.slice(0, 300),
      score_version: MATCH_SCORE_VERSION,
    }, status);
  }

});
