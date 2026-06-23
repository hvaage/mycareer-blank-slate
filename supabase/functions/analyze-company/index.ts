// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildRegisterContextText,
  EMPLOYER_DIMENSIONS,
  financialsFromRegisterContext,
  normalizeEmployerAnalysisV2,
} from "./analysis-v2.ts";

/**
 * Supabase Edge exposes `EdgeRuntime.waitUntil` so the isolate can finish async work after the HTTP
 * response is sent. In local / misconfigured runtimes that helper is missing — if we only attach
 * `.catch`, the request ends and the isolate may freeze before analysis completes, leaving
 * `research_log` stuck on `pending` forever.
 */
async function runAnalysisBackground(work: Promise<unknown>): Promise<void> {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof er?.waitUntil === "function") {
    er.waitUntil(work);
    return;
  }
  await work;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COMPANY_CACHE_DAYS = 90;

const COMPANY_SYSTEM_PROMPT = `You are a senior employer research analyst with web_search. Produce a thorough, evidence-based employer profile for job seekers.

SOURCE OF TRUTH:
- The user message can contain a LOCAL_REGISTER_CONTEXT from Karrierenmin's own Bronnoysund mirror. Treat its legal-entity fields and financial figures as authoritative for that Norwegian organisation number.
- Use web research to supplement culture, leadership, work environment, careers, mission, talent, diversity and AI maturity. Do not replace local financial facts with third-party aggregator figures.
- Distinguish the selected Norwegian legal entity from its parent group whenever evidence concerns different scopes.

RESEARCH DEPTH:
- Call web_search several times across official company material, annual reports, reputable editorial coverage, regulators and independent employee/reputation evidence.
- Aim for at least 12 distinct credible HTTPS sources when available, with several source categories.
- A scored employer dimension requires at least two independent supporting sources. If evidence is insufficient, use score=null and evidence_status="insufficient_evidence". Never convert missing evidence into a low score.

USER-FACING SOURCE LANGUAGE:
- User-facing narratives must NEVER name employee-review, reputation-rating or salary-comparison platforms. Use neutral phrases such as "uavhengige ansattvurderinger", "eksterne vurderingskilder" and "lønnssammenligningskilder".
- Exact source URLs belong only in the structured sources array for traceability. Do not include platform/domain names in executive_summary, key_findings, dimension rationales, what_it_means, AI narrative, AI signal rationales or key_evidence.

LANGUAGE AND SCOPE:
- Write all narrative fields in Norwegian Bokmal.
- Keep the company analysis neutral and company-level. Do not personalize it to an individual candidate.
- Scores use 1.0-5.0 in 0.5 increments; 3.0 is neutral. Use null for insufficient evidence.

Return ONLY JSON with this exact structure:
{
  "overall": {
    "score": <mean of scored employer dimensions or null>,
    "scored_dimensions": <0-8>,
    "total_dimensions": 8
  },
  "executive_summary": "<Norwegian evidence-based summary, 400-700 words>",
  "key_findings": ["<5-8 concise Norwegian findings>"],
  "dimensions": [
    {
      "key": "<culture|leadership|work_environment|career_development|financial_stability|mission|talent_attraction_retention|diversity_inclusion>",
      "score": <number or null>,
      "evidence_status": "<sourced|inferred|insufficient_evidence>",
      "rationale": "<Norwegian, evidence and uncertainty, no platform names>",
      "what_it_means": "<Norwegian consequence for a prospective employee>",
      "source_ids": [<source ids>]
    }
  ],
  "ai_maturity": {
    "applicable": <boolean>,
    "applicability_note": "<Norwegian reason or null>",
    "score": <mean of available signal scores or null>,
    "narrative": "<Norwegian overall AI maturity assessment>",
    "signals": {
      "strategy_and_leadership": {"score": <number or null>, "rationale": "<Norwegian>", "source_ids": []},
      "capability_and_deployment": {"score": <number or null>, "rationale": "<Norwegian>", "source_ids": []},
      "workforce": {"score": <number or null>, "rationale": "<Norwegian>", "source_ids": []},
      "governance": {"score": <number or null>, "rationale": "<Norwegian>", "source_ids": []},
      "market_and_product": {"score": <number or null>, "rationale": "<Norwegian>", "source_ids": []}
    },
    "key_evidence": ["<Norwegian evidence bullets>"],
    "source_ids": [<source ids>]
  },
  "sources": [
    {
      "id": <positive integer>,
      "url": "<https URL>",
      "category": "<official_company|official_register|annual_report|news_media|regulator|employee_reviews|salary_benchmark|other>"
    }
  ]
}

Return all eight employer dimensions exactly once and all five AI signals exactly once.`;

const CANDIDATE_FIT_SYSTEM_PROMPT = `Du er en senior jobbmatch-analytiker. Du får et ferdig selskapsnotat (kun generelle selskapsfakta) og en kandidatprofil. Ikke gjør nye nettsøk — bruk bare innholdet du får.

VIKTIG: Svar skal beskrive hvordan DENNE KANDIDATEN passer (eller ikke) til selskapet. Ikke gjenta selskapets generelle fakta som om det var en upersonlig bedriftsartikkel — koble eksplisitt til kandidatens mål, erfaring, preferanser og risiko.

Returner KUN et JSON-objekt (ingen markdown fences, ingen tekst utenfor JSON). I "fit_reasoning" kan du bruke markdown (avsnitt, **fet**, lister) for lesbarhet.

{
  "ai_candidate_fit_score": <tall 1.0–5.0 i 0.5-steg>,
  "fit_reasoning": "<Norwegian markdown, 12–22 setninger tilsvarende. Struktur: (1) Kort konklusjon (2) **Styrker** — punktliste eller avsnitt (3) **Gap / risiko** — hva bør kandidaten være obs på (4) **Anbefaling** — neste steg eller forbehold. Henvis til konkrete dimensjoner (kultur, økonomi, karriere, osv.) og kandidatens profil.>"
}

Skala: 1.0 = dårlig match, 3.0 = nøytral, 5.0 = sterk match.`;

function fmt(label: string, value: any): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `${label}: ${value.join(", ")}`;
  }
  if (typeof value === "string" && value.trim() === "") return null;
  return `${label}: ${value}`;
}

function buildProfileText(p: any): string {
  if (!p) return "(no profile data available)";
  const lines = [
    fmt("Navn", p.full_name ?? p.display_name),
    fmt("LinkedIn-tittel", p.linkedin_headline),
    fmt("Current role", p.current_role_title),
    fmt("Current employer", p.current_employer),
    fmt("Jobbsøk-nøkkelord", p.job_search_keywords),
    fmt("Merknader", p.additional_notes),
    fmt("Years of experience", p.years_experience),
    fmt("Headline", p.headline),
    fmt("Bio", p.bio),
    fmt("Target roles", p.target_roles),
    fmt("Target industries", p.target_industries),
    fmt("Target seniority", p.target_seniority),
    fmt("Target country", p.target_country),
    fmt("Target region", p.target_region),
    fmt("Target city", p.target_city),
    fmt("Work types", p.work_types),
    fmt("Skills", p.skills),
    fmt("Industries", p.industries),
    fmt("Languages", p.languages),
    fmt("Motivation", p.motivation),
    fmt("Strengths", p.strengths),
    fmt("Weaknesses", p.weaknesses),
    fmt("Achievements", p.achievements),
    fmt("Deal breakers", p.deal_breakers),
    p.salary_expectation_min || p.salary_expectation_max
      ? `Salary expectation: ${p.salary_expectation_min ?? "?"}–${p.salary_expectation_max ?? "?"} ${p.salary_currency ?? ""}`
      : null,
    fmt("Willing to relocate", p.willing_to_relocate),
    fmt("Available from", p.available_from),
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(profile is empty)";
}

function buildCompanySnapshotText(snap: any): string {
  if (!snap) return "(no company data)";
  const v2 = snap.employer_analysis_v2 ?? {};
  const v2Dimensions = Array.isArray(v2.dimensions) ? v2.dimensions : [];
  const aiMaturity = v2.ai_maturity ?? {};
  const dim = snap.ai_dimension_notes ?? {};
  const fin = snap.financials ?? {};
  const lines = [
    fmt("Selskap", snap.name),
    fmt("Bransje", snap.industry),
    fmt("Beskrivelse", snap.description),
    fmt("Kultur (score)", snap.ai_culture_score),
    fmt("Kultur (notat)", dim.culture),
    fmt("Ledelse (score)", snap.ai_leadership_score),
    fmt("Ledelse (notat)", dim.leadership),
    fmt("Arbeidsmiljø (score)", snap.ai_work_environment_score),
    fmt("Arbeidsmiljø (notat)", dim.work_environment),
    fmt("Karriereutvikling (score)", snap.ai_career_development_score),
    fmt("Karriere (notat)", dim.career_development),
    fmt("Økonomi (score)", snap.ai_financial_stability_score),
    fmt("Økonomi (notat)", dim.financial_stability),
    fmt("Misjon (score)", snap.ai_mission_score),
    fmt("Misjon (notat)", dim.mission),
    fmt("Omsetning", fin.revenue_latest),
    fmt("Omsetning trend", fin.revenue_trend),
    fmt("Resultat", fin.profit_latest),
    fmt("Egenkapitalandel", fin.equity_ratio),
    fmt("Betalingsanmerkninger", fin.payment_remarks),
    fmt("Sammendrag", snap.ai_rating_notes),
    v2Dimensions.length
      ? `Arbeidsgiverdimensjoner v2:\n${v2Dimensions.map((item: any) =>
        `${item.label ?? item.key}: ${item.score ?? "ikke vurdert"} — ${clampStr(item.rationale, 1200)}`
      ).join("\n")}`
      : null,
    aiMaturity && typeof aiMaturity === "object"
      ? fmt("AI-modenhet v2", clampStr(JSON.stringify(aiMaturity), 5000))
      : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(company snapshot empty)";
}

/** Persisted in ai_candidate_fit_reasoning when profile is too thin for a meaningful match. */
const CANDIDATE_FIT_UNAVAILABLE_PREFIX = "STATUS:KAN_IKKE_VURDERES";

function normalizeFitScore(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? parseFloat(String(raw).trim().replace(",", "."))
        : NaN;
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(5, Math.max(1, n));
  return Math.round(clamped * 2) / 2;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text.trim());
  } catch {
    const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1].trim());
      } catch {
        /* ignore */
      }
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error("Could not parse JSON from model response");
  }
}

type AnalysisSource = { id: number; url: string; category: string };

const SOURCE_CATEGORIES = new Set([
  "official_company",
  "official_register",
  "annual_report",
  "news_media",
  "regulator",
  "employee_reviews",
  "salary_benchmark",
  "other",
]);

function normalizeAnalysisSources(sources: unknown): AnalysisSource[] {
  if (!Array.isArray(sources)) return [];
  const out: AnalysisSource[] = [];
  const seen = new Set<string>();
  const usedIds = new Set<number>();
  for (const item of sources) {
    const raw = typeof item === "string"
      ? { url: item, category: "other" }
      : item && typeof item === "object"
        ? item as Record<string, unknown>
        : null;
    if (!raw || typeof raw.url !== "string") continue;
    const t = raw.url.trim();
    if (!/^https?:\/\//i.test(t)) continue;
    const low = t.split("?")[0].split("#")[0].toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    const category = typeof raw.category === "string" && SOURCE_CATEGORIES.has(raw.category)
      ? raw.category
      : "other";
    const requestedId = Number(raw.id);
    let id = Number.isInteger(requestedId) && requestedId > 0 && !usedIds.has(requestedId)
      ? requestedId
      : out.length + 1;
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    out.push({ id, url: t, category });
  }
  return out.slice(0, 40);
}

function normalizeSourceUrls(sources: unknown): string[] {
  return normalizeAnalysisSources(sources).map((source) => source.url);
}

function evaluationSourceBrandTokens(sources: AnalysisSource[]): string[] {
  const tokens = new Set<string>();
  for (const source of sources) {
    if (source.category !== "employee_reviews" && source.category !== "salary_benchmark") continue;
    try {
      const parts = new URL(source.url).hostname.toLowerCase().replace(/^www\./, "").split(".");
      const token = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      if (token && /^[a-z0-9-]{3,40}$/.test(token)) tokens.add(token);
    } catch {
      // Invalid URLs were filtered by normalizeAnalysisSources.
    }
  }
  return Array.from(tokens);
}

function lastAnalyzeCompanySourcesFromRow(row: { research_log?: unknown }): string[] {
  const log = row?.research_log;
  if (!Array.isArray(log)) return [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as { via?: string; sources?: unknown } | null;
    if (e?.via === "analyze-company" && Array.isArray(e.sources)) {
      const n = normalizeSourceUrls(e.sources);
      if (n.length) return n;
    }
  }
  return [];
}

function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = input.startsWith("http") ? new URL(input) : new URL(`https://${input}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeOrganisationNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

async function loadEmployerRegisterContext(supabase: any, organisationNumber: string | null) {
  if (!organisationNumber) return null;
  const { data, error } = await supabase.rpc("get_employer_analysis_context", {
    p_organisasjonsnummer: organisationNumber,
  });
  if (error) throw new Error(`register_context_failed: ${error.message}`);
  return data && typeof data === "object" ? data : null;
}

function sourceUpdatedAtFromContext(context: any): string | null {
  const value = context?.source_updated_at;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function companyPatchFromRegisterContext(context: any): Record<string, unknown> {
  const entity = context?.entity && typeof context.entity === "object" ? context.entity : {};
  const employeeCount = typeof entity.employee_count === "number" ? entity.employee_count : null;
  const sizeEstimate = employeeCount == null
    ? null
    : employeeCount === 0
      ? "0"
      : employeeCount <= 4
        ? "1-4"
        : employeeCount <= 19
          ? "5-19"
          : employeeCount <= 99
            ? "20-99"
            : employeeCount <= 499
              ? "100-499"
              : "500+";
  const website = typeof entity.website === "string" ? extractDomain(entity.website) : null;
  return {
    name: typeof entity.legal_name === "string" ? entity.legal_name : undefined,
    domain: website ?? undefined,
    country: "NO",
    industry: typeof entity.industry_primary === "string" ? entity.industry_primary : undefined,
    description: typeof entity.activity === "string" ? entity.activity : undefined,
    size_estimate: sizeEstimate ?? undefined,
    ownership_type: entity.is_public === true ? "public" : undefined,
    brreg_matched_at: new Date().toISOString(),
    brreg_match_source: "brreg_orgnr",
    brreg_match_confidence: 1,
  };
}

const RATE_LIMIT_USER_MESSAGE =
  "AI-tjenesten er midlertidig opptatt. Prøv igjen om litt.";

/** Thrown when Anthropic returns HTTP 429 (TPM / RPM). */
class AnthropicRateLimitError extends Error {
  retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "AnthropicRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

function isAnthropicRateLimitError(e: unknown): e is AnthropicRateLimitError {
  return e instanceof AnthropicRateLimitError;
}

function clampStr(s: unknown, maxChars: number): string {
  if (s == null) return "";
  const t = typeof s === "string" ? s : String(s);
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n… (forkortet for token-grense)";
}

/** Compact company context for candidate-fit only (scores + truncated notes; no research_log / sources). */
function buildCandidateFitCompanyContext(snap: any): string {
  if (!snap) return "(no company data)";
  const v2 = snap.employer_analysis_v2 ?? {};
  const v2Dimensions = Array.isArray(v2.dimensions) ? v2.dimensions : [];
  const aiMaturity = v2.ai_maturity ?? null;
  const dim = snap.ai_dimension_notes ?? {};
  const fin = snap.financials ?? {};
  const finLine = [
    fin.revenue_latest,
    fin.revenue_trend,
    fin.profit_latest,
    fin.equity_ratio,
    fin.payment_remarks,
  ].filter(Boolean).join(" · ");
  const lines = [
    fmt("Selskap", snap.name),
    fmt("Bransje", snap.industry),
    fmt("Domene", snap.domain),
    `AI-snitt: ${snap.ai_overall_score ?? "—"} (kultur ${snap.ai_culture_score ?? "—"}, ledelse ${snap.ai_leadership_score ?? "—"}, miljø ${snap.ai_work_environment_score ?? "—"}, karriere ${snap.ai_career_development_score ?? "—"}, økonomi ${snap.ai_financial_stability_score ?? "—"}, misjon ${snap.ai_mission_score ?? "—"})`,
    fmt("Sammendrag (AI)", clampStr(snap.ai_rating_notes, 4500)),
    fmt("Kultur (kort)", clampStr(dim.culture, 1400)),
    fmt("Ledelse (kort)", clampStr(dim.leadership, 1400)),
    fmt("Arbeidsmiljø (kort)", clampStr(dim.work_environment, 1400)),
    fmt("Karriere (kort)", clampStr(dim.career_development, 1400)),
    fmt("Økonomi (kort)", clampStr(dim.financial_stability, 1400)),
    fmt("Misjon (kort)", clampStr(dim.mission, 1400)),
    finLine ? `Økonomi (strukturert): ${finLine}` : null,
    fmt("Økonomi-notat (kort)", clampStr(fin.notes, 1200)),
    v2Dimensions.length
      ? `Arbeidsgiverdimensjoner (8):\n${v2Dimensions.map((item: any) =>
        `${item.label ?? item.key}: ${item.score ?? "ikke vurdert"}; ${clampStr(item.rationale, 900)}`
      ).join("\n")}`
      : null,
    aiMaturity
      ? fmt("AI-modenhet (5 områder)", clampStr(JSON.stringify(aiMaturity), 4500))
      : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function capProfileBlockForFit(block: string, maxChars: number): string {
  const t = block.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n… (profil forkortet for token-grense)";
}

function parseRetryAfterMs(res: Response, errBody: string): number | null {
  const h = res.headers.get("retry-after");
  if (h) {
    const sec = parseInt(h.trim(), 10);
    if (Number.isFinite(sec) && sec > 0 && sec < 7200) return sec * 1000;
    const ts = Date.parse(h);
    if (!Number.isNaN(ts)) return Math.max(0, ts - Date.now());
  }
  try {
    const j = JSON.parse(errBody);
    const reset = j?.error?.details?.reset_at ?? j?.error?.reset_at;
    if (typeof reset === "string") {
      const t = Date.parse(reset);
      if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function callAnthropic(apiKey: string, body: any): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 429) {
      const retryMs = parseRetryAfterMs(res, raw);
      throw new AnthropicRateLimitError(raw.slice(0, 2000), retryMs);
    }
    throw new Error(`Anthropic ${res.status}: ${raw}`);
  }
  const json = JSON.parse(raw);
  return (json?.content ?? [])
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

async function rateLimitEmployerJob(
  supabase: any,
  jobId: string,
  opts: { technical?: string; retryAfterMs: number | null },
) {
  const now = new Date();
  const defaultWaitMs = 90_000;
  const waitMs = opts.retryAfterMs != null && opts.retryAfterMs > 0
    ? Math.min(Math.max(opts.retryAfterMs, 15_000), 600_000)
    : defaultWaitMs;
  const retryAfterAt = new Date(now.getTime() + waitMs).toISOString();
  if (opts.technical) {
    console.error("employer_analysis_jobs rate_limited technical:", opts.technical.slice(0, 2000));
  }
  await supabase.from("employer_analysis_jobs").update({
    status: "rate_limited",
    error_message: RATE_LIMIT_USER_MESSAGE.slice(0, 4000),
    retry_after_at: retryAfterAt,
    completed_at: now.toISOString(),
    current_step: "rate_limited",
    progress_percent: Math.min(100, Math.max(0, 78)),
    updated_at: now.toISOString(),
  }).eq("id", jobId);
}

async function updateEmployerJob(supabase: any, jobId: string, patch: Record<string, unknown>) {
  await supabase.from("employer_analysis_jobs").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function failEmployerJob(supabase: any, jobId: string, message: string) {
  const now = new Date().toISOString();
  console.error("employer_analysis_jobs failed:", jobId, message);
  const userMsg = "AI-analysen kunne ikke fullføres akkurat nå. Prøv igjen om litt.";
  await supabase.from("employer_analysis_jobs").update({
    status: "failed",
    error_message: userMsg.slice(0, 4000),
    completed_at: now,
    current_step: "failed",
    updated_at: now,
  }).eq("id", jobId);
}

async function getOrCreateEmployerJob(
  supabase: any,
  userId: string,
  companyId: string,
): Promise<{ id: string; reused: boolean }> {
  const { data: active } = await supabase
    .from("employer_analysis_jobs")
    .select("id, status, retry_after_at")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .in("status", ["queued", "processing", "rate_limited"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active?.id) {
    if (active.status === "rate_limited") {
      const until = active.retry_after_at ? new Date(active.retry_after_at as string) : null;
      if (until && until > new Date()) {
        return { id: active.id as string, reused: true };
      }
      const now = new Date().toISOString();
      await supabase.from("employer_analysis_jobs").update({
        status: "queued",
        error_message: null,
        retry_after_at: null,
        completed_at: null,
        current_step: "queued",
        progress_percent: 0,
        started_at: now,
        updated_at: now,
      }).eq("id", active.id);
      return { id: active.id as string, reused: false };
    }
    return { id: active.id as string, reused: true };
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("employer_analysis_jobs")
    .insert({
      user_id: userId,
      company_id: companyId,
      status: "queued",
      progress_percent: 0,
      current_step: "queued",
      started_at: now,
    })
    .select("id")
    .single();

  if (error) {
    const { data: again } = await supabase
      .from("employer_analysis_jobs")
      .select("id, status, retry_after_at")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .in("status", ["queued", "processing", "rate_limited"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (again?.id) {
      if (again.status === "rate_limited") {
        const until = again.retry_after_at ? new Date(again.retry_after_at as string) : null;
        if (until && until > new Date()) return { id: again.id as string, reused: true };
        const ts = new Date().toISOString();
        await supabase.from("employer_analysis_jobs").update({
          status: "queued",
          error_message: null,
          retry_after_at: null,
          completed_at: null,
          current_step: "queued",
          progress_percent: 0,
          started_at: ts,
          updated_at: ts,
        }).eq("id", again.id);
        return { id: again.id as string, reused: false };
      }
      return { id: again.id as string, reused: true };
    }
    throw error;
  }
  return { id: inserted.id as string, reused: false };
}

function buildEmployerAnalysisMarkdown(row: any): string {
  const v2 = row.employer_analysis_v2;
  if (v2 && v2.schema_version === 2 && Array.isArray(v2.dimensions)) {
    const sourceLabels: Record<string, string> = {
      official_company: "Selskapets egne kilder",
      official_register: "Offentlige registre",
      annual_report: "Årsrapport og finansiell rapportering",
      news_media: "Redaksjonelle kilder",
      regulator: "Myndighets- og regulatorkilder",
      employee_reviews: "Uavhengige ansattvurderinger",
      salary_benchmark: "Lønnssammenligningskilder",
      other: "Annen ekstern kilde",
    };
    const lines: string[] = [
      `# Arbeidsgiveranalyse — ${row.name ?? "Selskap"}`,
      "",
      row.organisasjonsnummer ? `**Organisasjonsnummer:** ${row.organisasjonsnummer}` : null,
      row.industry ? `**Bransje:** ${row.industry}` : null,
      `**Samlet score:** ${v2.overall?.score ?? "—"} / 5 (${v2.overall?.scored_dimensions ?? 0} av 8 dimensjoner)`,
      "",
      "## Sammendrag",
      "",
      v2.executive_summary || "_Ingen sammendrag._",
      "",
      "## Hovedfunn",
      "",
      ...(Array.isArray(v2.key_findings) ? v2.key_findings.map((item: string) => `- ${item}`) : []),
      "",
      "## Arbeidsgiverdimensjoner",
      "",
      "| Dimensjon | Score | Evidens |",
      "|---|---:|---|",
      ...v2.dimensions.map((item: any) =>
        `| ${item.label ?? item.key} | ${item.score ?? "Ikke nok data"} | ${item.evidence_status ?? "—"} |`
      ),
      "",
      ...v2.dimensions.flatMap((item: any) => [
        `### ${item.label ?? item.key}`,
        "",
        item.rationale || "_Ingen begrunnelse._",
        item.what_it_means ? `\n**Hva dette betyr:** ${item.what_it_means}` : "",
        "",
      ]),
      "## AI-modenhet",
      "",
      v2.ai_maturity?.applicable === false
        ? v2.ai_maturity?.applicability_note ?? "Ikke vurdert for denne virksomheten."
        : `**Samlet AI-score:** ${v2.ai_maturity?.score ?? "—"} / 5`,
      "",
      v2.ai_maturity?.narrative ?? "",
      "",
      "| AI-område | Score | Vurdering |",
      "|---|---:|---|",
      ...Object.values(v2.ai_maturity?.signals ?? {}).map((signal: any) =>
        `| ${signal.label ?? "AI-signal"} | ${signal.score ?? "Ikke nok data"} | ${signal.rationale ?? ""} |`
      ),
      "",
      "## Register- og regnskapsgrunnlag",
      "",
      row.financials?.source_kind === "brreg_local_mirror"
        ? `Lokalt speil av Brønnøysundregistrene, siste regnskapsår ${row.financials?.fiscal_year ?? "ukjent"}.`
        : "Ingen lokal registerkontekst var tilgjengelig for denne analysen.",
    ];
    const sources = Array.isArray(v2.sources) ? v2.sources : [];
    if (sources.length) {
      lines.push(
        "",
        "## Kilder",
        "",
        ...sources.map((source: any, index: number) =>
          `- [Kilde ${index + 1}](${source.url}) — ${sourceLabels[source.category] ?? sourceLabels.other}`
        ),
      );
    }
    return lines.filter((item) => item != null).join("\n");
  }

  const dim = row.ai_dimension_notes ?? {};
  const fin = row.financials ?? {};
  const lines: string[] = [
    `# AI-arbeidsgiveranalyse — ${row.name ?? "Selskap"}`,
    "",
    row.industry ? `**Bransje:** ${row.industry}` : null,
    row.domain ? `**Domene:** ${row.domain}` : null,
    "",
    "## Scorer (1–5)",
    "",
    `| Dimensjon | Score |`,
    `|----------|------|`,
    `| Kultur | ${row.ai_culture_score ?? "—"} |`,
    `| Ledelse | ${row.ai_leadership_score ?? "—"} |`,
    `| Arbeidsmiljø | ${row.ai_work_environment_score ?? "—"} |`,
    `| Karriere | ${row.ai_career_development_score ?? "—"} |`,
    `| Økonomi | ${row.ai_financial_stability_score ?? "—"} |`,
    `| Misjon | ${row.ai_mission_score ?? "—"} |`,
    `| **Snitt** | **${row.ai_overall_score ?? "—"}** |`,
    "",
    "## Sammendrag",
    "",
    row.ai_rating_notes ?? "_Ingen sammendrag._",
    "",
    "## Dimensjonsnotater",
    "",
    ...["culture", "leadership", "work_environment", "career_development", "financial_stability", "mission"].map(
      (k) => `### ${k}\n\n${dim[k] ?? "_—_"}\n`,
    ),
    "## Økonomi (strukturert)",
    "",
    "```json",
    JSON.stringify(fin, null, 2),
    "```",
  ];
  const srcs = lastAnalyzeCompanySourcesFromRow(row);
  if (srcs.length) {
    lines.push("", "## Kilder", "", ...srcs.map((u) => `- ${u}`));
  }
  return lines.filter((x) => x != null).join("\n");
}

async function syncEmployerArtifactDocument(
  supabase: any,
  opts: { jobId: string; userId: string; companyId: string },
) {
  const { data: row } = await supabase.from("companies").select("*").eq("id", opts.companyId).maybeSingle();
  if (!row?.ai_rated_at) return;

  const dedupe = `employer_ai_analysis:${opts.companyId}`;
  const title = `AI-arbeidsgiveranalyse — ${row.name ?? "Selskap"}`;
  const markdown = buildEmployerAnalysisMarkdown(row);

  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("customization_notes", dedupe)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing?.id) {
    await supabase.from("documents").update({
      title,
      content_text: markdown,
      company_name: row.name ?? null,
      updated_at: now,
    }).eq("id", existing.id);
    await supabase.from("employer_analysis_jobs").update({
      artifact_document_id: existing.id,
      updated_at: now,
    }).eq("id", opts.jobId);
    return;
  }

  const { data: ins, error } = await supabase.from("documents").insert({
    user_id: opts.userId,
    title,
    document_type: "annet",
    content_text: markdown,
    company_name: row.name ?? null,
    customization_notes: dedupe,
    application_id: null,
  }).select("id").single();

  if (error) {
    console.error("syncEmployerArtifactDocument insert failed:", error);
    return;
  }

  await supabase.from("employer_analysis_jobs").update({
    artifact_document_id: ins.id,
    updated_at: now,
  }).eq("id", opts.jobId);
}

async function runCompanyAnalysis(
  supabase: any,
  apiKey: string,
  company: { id: string; name: string; domain: string | null; country?: string | null },
  registerContext: any,
  user_id: string,
  jobId?: string | null,
): Promise<any | null> {
  try {
    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        status: "processing",
        current_step: "claude_company_web_research",
        progress_percent: 20,
      });
    }

    const countryHint = (company as { country?: string | null }).country ?? "unknown";
    const userMessage = `Research employer: "${company.name}".

Known domain hint: ${company.domain ?? "none"}
Country / market hint: ${countryHint}
Organisation number: ${(company as any).organisasjonsnummer ?? "none"}

LOCAL_REGISTER_CONTEXT (authoritative for the selected Norwegian legal entity):
${buildRegisterContextText(registerContext)}

Before composing JSON: use web_search several times with varied queries (official careers/about, annual reports, news last 24 months, independent employee evidence where relevant, industry and regulators). Minimum 12 unique HTTPS URLs when credible material exists; diversify source categories.

Return only the JSON object specified in the system instructions.`;
    const text = await callAnthropic(apiKey, {
      model: "claude-sonnet-4-6",
      max_tokens: 12000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: COMPANY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const parsed = parseJson(text) as any;
    const analysisSources = normalizeAnalysisSources(parsed.sources);
    const analysisV2 = normalizeEmployerAnalysisV2(
      parsed,
      evaluationSourceBrandTokens(analysisSources),
    );
    const registerFinancials = financialsFromRegisterContext(registerContext);
    const registerSourceUpdatedAt = sourceUpdatedAtFromContext(registerContext);
    const persistedAnalysisV2 = {
      ...analysisV2,
      sources: analysisSources,
      register_provenance: registerContext
        ? {
          source: "brreg_local_mirror",
          organisasjonsnummer: registerContext.organisasjonsnummer ?? (company as any).organisasjonsnummer ?? null,
          source_updated_at: registerSourceUpdatedAt,
          financial_years: Array.isArray(registerContext.financial_history)
            ? registerContext.financial_history
              .map((item: any) => item?.year)
              .filter((year: unknown) => typeof year === "number")
            : [],
        }
        : null,
    };
    const now = new Date().toISOString();

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "parsing_and_validating",
        progress_percent: 40,
      });
    }

    const { data: existing } = await supabase
      .from("companies")
      .select("research_log")
      .eq("id", company.id)
      .maybeSingle();
    const existingLog = Array.isArray(existing?.research_log) ? existing!.research_log : [];

    const sourcesArr = analysisSources.map((source) => source.url);

    const newLog = [
      ...existingLog,
      {
        at: now,
        by: user_id,
        status: "completed",
        via: "analyze-company",
        analysis_version: 2,
        sources: sourcesArr,
        source_categories: Array.from(new Set(analysisSources.map((source) => source.category))),
        dimensions: EMPLOYER_DIMENSIONS.map((dimension) => dimension.key),
        ai_maturity_signals: Object.keys(analysisV2.ai_maturity.signals),
        register_context_used: !!registerContext,
        organisasjonsnummer: (company as any).organisasjonsnummer ?? null,
      },
    ].slice(-20);

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "writing_company_row",
        progress_percent: 58,
      });
    }

    const dimensionByKey = new Map(
      analysisV2.dimensions.map((dimension) => [dimension.key, dimension]),
    );
    const updatePayload: Record<string, unknown> = {
      ai_culture_score: dimensionByKey.get("culture")?.score ?? null,
      ai_leadership_score: dimensionByKey.get("leadership")?.score ?? null,
      ai_work_environment_score: dimensionByKey.get("work_environment")?.score ?? null,
      ai_career_development_score: dimensionByKey.get("career_development")?.score ?? null,
      ai_financial_stability_score: dimensionByKey.get("financial_stability")?.score ?? null,
      ai_mission_score: dimensionByKey.get("mission")?.score ?? null,
      ai_overall_score: analysisV2.overall.score,
      ai_rating_notes: analysisV2.executive_summary,
      ai_dimension_notes: Object.fromEntries(
        analysisV2.dimensions.map((dimension) => [dimension.key, dimension.rationale]),
      ),
      ai_rated_at: now,
      employer_analysis_v2: persistedAnalysisV2,
      employer_analysis_version: 2,
      employer_analysis_rated_at: now,
      employer_analysis_source_updated_at: registerSourceUpdatedAt,
      research_log: newLog,
      updated_at: now,
    };
    if (registerFinancials) updatePayload.financials = registerFinancials;

    const { error: updErr } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("id", company.id);
    if (updErr) {
      console.error("companies AI update failed (schema drift or RLS):", updErr);
      throw new Error(updErr.message ?? "companies_ai_update_failed");
    }

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "company_scores_saved",
        progress_percent: 72,
      });
    }

    // Return fresh snapshot — use * so missing optional columns do not break the select
    const { data: refreshed } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company.id)
      .maybeSingle();
    return refreshed;
  } catch (e) {
    console.error("runCompanyAnalysis error:", e);
    if (jobId) {
      if (isAnthropicRateLimitError(e)) {
        await rateLimitEmployerJob(supabase, jobId, {
          technical: e.message,
          retryAfterMs: e.retryAfterMs,
        });
      } else {
        await failEmployerJob(supabase, jobId, (e as Error)?.message ?? "unknown");
      }
    }
    await markAnalysisFailed(supabase, company.id, user_id, (e as Error)?.message ?? "unknown");
    return null;
  }
}

async function runCandidateFit(
  supabase: any,
  apiKey: string,
  company_id: string,
  user_id: string,
  snapshot: any,
  profile: any,
  jobId?: string | null,
) {
  const now = () => new Date().toISOString();
  try {
    if (!snapshot || snapshot.ai_rated_at == null) {
      console.log("Skipping candidate fit — no snapshot");
      return;
    }

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "candidate_fit_preparing",
        progress_percent: 74,
      });
    }

    const profileBlock = buildProfileText(profile);
    const profileInsufficient =
      !profile ||
      profileBlock === "(profile is empty)" ||
      profileBlock === "(no profile data available)";

    if (profileInsufficient) {
      const ts = now();
      const reasoning =
        `${CANDIDATE_FIT_UNAVAILABLE_PREFIX}\n\n` +
        "Profilen din har for lite innhold til en meningsfull kandidatmatch (bio, mål, roller, ferdigheter, osv.). " +
        "Fyll ut **Om meg** og eventuelt CV-data, deretter kjør **Oppdater AI-analyse**.";
      const { error: upErr } = await supabase.from("user_company_ratings").upsert(
        {
          user_id,
          company_id,
          ai_candidate_fit_score: null,
          ai_candidate_fit_reasoning: reasoning,
          ai_candidate_fit_updated_at: ts,
          updated_at: ts,
        },
        { onConflict: "user_id,company_id" },
      );
      if (upErr) {
        console.error("runCandidateFit unavailable upsert failed:", upErr);
        throw new Error(upErr.message ?? "candidate_fit_unavailable_upsert_failed");
      }
      if (jobId) {
        await updateEmployerJob(supabase, jobId, {
          current_step: "candidate_fit_saved",
          progress_percent: 86,
        });
      }
      return;
    }

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "claude_candidate_fit",
        progress_percent: 78,
      });
    }

    const userMessage =
      `Selskaps-kontekst (kompakt — ikke full nett-research):\n${buildCandidateFitCompanyContext(snapshot)}\n\nKandidatprofil:\n${capProfileBlockForFit(profileBlock, 9000)}\n\nReturner kun JSON-objektet.`;
    const text = await callAnthropic(apiKey, {
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: CANDIDATE_FIT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const parsed = parseJson(text);
    const score = normalizeFitScore(
      parsed.ai_candidate_fit_score ?? parsed.fit_score ?? parsed.candidate_fit_score,
    );
    const reasoningRaw =
      typeof parsed.fit_reasoning === "string"
        ? parsed.fit_reasoning
        : typeof parsed.ai_candidate_fit_reasoning === "string"
          ? parsed.ai_candidate_fit_reasoning
          : null;

    const ts = now();
    if (score == null) {
      console.warn(
        "runCandidateFit: could not parse numeric ai_candidate_fit_score; raw=",
        JSON.stringify(parsed).slice(0, 1200),
      );
      const fallbackReason =
        (reasoningRaw ? `${reasoningRaw.trim()}\n\n` : "") +
        "Teknisk: AI-vurderingen returnerte ikke en gyldig numerisk score (1–5). Prøv **Oppdater AI-analyse**.";
      const { error: upErr } = await supabase.from("user_company_ratings").upsert(
        {
          user_id,
          company_id,
          ai_candidate_fit_score: null,
          ai_candidate_fit_reasoning: fallbackReason,
          ai_candidate_fit_updated_at: ts,
          updated_at: ts,
        },
        { onConflict: "user_id,company_id" },
      );
      if (upErr) {
        console.error("runCandidateFit fallback upsert failed:", upErr);
        throw new Error(upErr.message ?? "candidate_fit_fallback_upsert_failed");
      }
      if (jobId) {
        await updateEmployerJob(supabase, jobId, {
          current_step: "candidate_fit_saved",
          progress_percent: 86,
        });
      }
      return;
    }

    const { error: upErr } = await supabase.from("user_company_ratings").upsert(
      {
        user_id,
        company_id,
        ai_candidate_fit_score: score,
        ai_candidate_fit_reasoning: reasoningRaw ?? null,
        ai_candidate_fit_updated_at: ts,
        updated_at: ts,
      },
      { onConflict: "user_id,company_id" },
    );
    if (upErr) {
      console.error("runCandidateFit upsert failed:", upErr);
      throw new Error(upErr.message ?? "candidate_fit_upsert_failed");
    }
    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "candidate_fit_saved",
        progress_percent: 86,
      });
    }
  } catch (e) {
    console.error("runCandidateFit error:", e);
    throw e;
  }
}

async function appendPendingResearchLog(supabase: any, companyId: string, userId: string) {
  const startedAt = new Date().toISOString();
  try {
    const { data: existing } = await supabase
      .from("companies")
      .select("research_log")
      .eq("id", companyId)
      .maybeSingle();
    const existingLog = Array.isArray(existing?.research_log) ? existing!.research_log : [];
    const pendingLog = [
      ...existingLog,
      { at: startedAt, by: userId, status: "pending", via: "analyze-company" },
    ].slice(-20);
    const { error: pendErr } = await supabase
      .from("companies")
      .update({ research_log: pendingLog, updated_at: startedAt })
      .eq("id", companyId);
    if (pendErr) console.error("pending research_log update skipped:", pendErr);
  } catch (e) {
    console.error("pending log write failed:", e);
  }
}

async function runEmployerAnalysisPipeline(
  supabase: any,
  apiKey: string,
  ctx: {
    jobId: string;
    userId: string;
    company: any;
    registerContext: any;
    profile: any;
    companyFresh: boolean;
    userHasFit: boolean;
    force: boolean | undefined;
    candidateFitOnly?: boolean;
  },
) {
  const { jobId, userId, company, registerContext, profile, companyFresh, candidateFitOnly } = ctx;
  try {
    await updateEmployerJob(supabase, jobId, {
      status: "processing",
      current_step: "starting",
      progress_percent: 5,
      started_at: new Date().toISOString(),
    });

    const runCompanySide = !companyFresh && !candidateFitOnly;

    if (runCompanySide) {
      await appendPendingResearchLog(supabase, company.id, userId);
      const fresh = await runCompanyAnalysis(
        supabase,
        apiKey,
        company,
        registerContext,
        userId,
        jobId,
      );
      if (!fresh) {
        return;
      }
      try {
        await runCandidateFit(supabase, apiKey, company.id, userId, fresh, profile, jobId);
      } catch (fitErr) {
        if (isAnthropicRateLimitError(fitErr)) {
          await rateLimitEmployerJob(supabase, jobId, {
            technical: fitErr.message,
            retryAfterMs: fitErr.retryAfterMs,
          });
          return;
        }
        throw fitErr;
      }
    } else {
      await updateEmployerJob(supabase, jobId, {
        current_step: candidateFitOnly ? "candidate_fit_only" : "candidate_fit_cached_company",
        progress_percent: 35,
      });
      const { data: companyRow } = await supabase
        .from("companies")
        .select("*")
        .eq("id", company.id)
        .maybeSingle();
      const companyForFit = companyRow ?? company;
      try {
        await runCandidateFit(supabase, apiKey, company.id, userId, companyForFit, profile, jobId);
      } catch (fitErr) {
        if (isAnthropicRateLimitError(fitErr)) {
          await rateLimitEmployerJob(supabase, jobId, {
            technical: fitErr.message,
            retryAfterMs: fitErr.retryAfterMs,
          });
          return;
        }
        throw fitErr;
      }
    }

    await updateEmployerJob(supabase, jobId, {
      current_step: "artifact_document",
      progress_percent: 90,
    });
    await syncEmployerArtifactDocument(supabase, { jobId, userId, companyId: company.id });

    await updateEmployerJob(supabase, jobId, {
      status: "completed",
      progress_percent: 100,
      completed_at: new Date().toISOString(),
      current_step: "done",
    });
  } catch (e) {
    if (isAnthropicRateLimitError(e)) {
      await rateLimitEmployerJob(supabase, jobId, {
        technical: (e as AnthropicRateLimitError).message,
        retryAfterMs: (e as AnthropicRateLimitError).retryAfterMs,
      });
      return;
    }
    const msg = (e as Error)?.message ?? String(e);
    console.error("runEmployerAnalysisPipeline error:", e);
    await failEmployerJob(supabase, jobId, msg);
    await markAnalysisFailed(supabase, company.id, userId, msg);
  }
}

async function markAnalysisFailed(supabase: any, company_id: string, user_id: string, reason: string) {
  const now = new Date().toISOString();
  try {
    const { data: existing } = await supabase
      .from("companies")
      .select("research_log")
      .eq("id", company_id)
      .maybeSingle();
    const existingLog = Array.isArray(existing?.research_log) ? existing!.research_log : [];
    const newLog = [
      ...existingLog,
      { at: now, by: user_id, status: "failed", reason },
    ].slice(-20);
    const { error } = await supabase.from("companies").update({ research_log: newLog }).eq("id", company_id);
    if (error) console.error("markAnalysisFailed research_log update skipped:", error);
  } catch (e) {
    console.error("markAnalysisFailed:", e);
  }
}

function jsonErr(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ error: code, message, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      company_id: bodyCompanyId,
      user_id: bodyUserId,
      name: bodyName,
      company_name: bodyCompanyName,
      domain: rawDomain,
      organisasjonsnummer: bodyOrganisationNumber,
      force,
      candidate_fit_only: bodyCandidateFitOnly,
      fit_only: bodyFitOnly,
    } = body ?? {};

    const name =
      typeof bodyName === "string" && bodyName.trim()
        ? bodyName.trim()
        : typeof bodyCompanyName === "string" && bodyCompanyName.trim()
        ? bodyCompanyName.trim()
        : undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonErr(
        401,
        "authentication_required",
        "Logg inn på nytt før du starter analysen.",
      );
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const resolvedUserId = authData?.user?.id ?? "";
    if (authErr || !resolvedUserId) {
      return jsonErr(401, "invalid_session", "Sesjonen er ugyldig. Logg inn på nytt.");
    }
    if (
      typeof bodyUserId === "string" &&
      bodyUserId.trim() &&
      bodyUserId.trim() !== resolvedUserId
    ) {
      return jsonErr(403, "user_id_mismatch", "Forespørselen kan bare kjøres for innlogget bruker.");
    }

    const organisationNumber = normalizeOrganisationNumber(bodyOrganisationNumber);
    if (bodyOrganisationNumber != null && !organisationNumber) {
      return jsonErr(400, "invalid_organisasjonsnummer", "Organisasjonsnummer må ha ni sifre.");
    }
    if (!bodyCompanyId && !name && !organisationNumber) {
      return jsonErr(
        400,
        "company_required",
        "Send company_id, organisasjonsnummer eller selskapsnavn.",
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonErr(
        503,
        "anthropic_not_configured",
        "AI-tjenesten er ikke riktig konfigurert akkurat nå. Prøv igjen senere eller kontakt support.",
      );
    }

    /** Avoid brittle column lists when local migrations lag behind generated types. */
    const COMPANY_SELECT = "*";

    let company: any = null;
    let registerContext: any = null;

    if (bodyCompanyId) {
      const { data } = await supabase
        .from("companies").select(COMPANY_SELECT).eq("id", bodyCompanyId).maybeSingle();
      if (!data) {
        return jsonErr(404, "company_not_found", "Fant ikke selskapet.");
      }
      company = data;
      if (organisationNumber) {
        const existingOrganisationNumber = normalizeOrganisationNumber(company.organisasjonsnummer);
        if (existingOrganisationNumber && existingOrganisationNumber !== organisationNumber) {
          return jsonErr(
            409,
            "company_organisasjonsnummer_conflict",
            "Selskapet er allerede koblet til et annet organisasjonsnummer.",
          );
        }
        if (!existingOrganisationNumber) {
          const { data: conflicting } = await supabase
            .from("companies")
            .select("id")
            .eq("organisasjonsnummer", organisationNumber)
            .neq("id", company.id)
            .maybeSingle();
          if (conflicting?.id) {
            return jsonErr(
              409,
              "organisasjonsnummer_already_linked",
              "Organisasjonsnummeret er allerede koblet til en annen selskapsprofil.",
              { existing_company_id: conflicting.id },
            );
          }
          registerContext = await loadEmployerRegisterContext(supabase, organisationNumber);
          if (!registerContext) {
            return jsonErr(404, "employer_not_found", "Fant ikke organisasjonsnummeret i registerspeilet.");
          }
          const { data: linked, error: linkError } = await supabase
            .from("companies")
            .update({
              organisasjonsnummer: organisationNumber,
              ...companyPatchFromRegisterContext(registerContext),
              updated_at: new Date().toISOString(),
            })
            .eq("id", company.id)
            .select(COMPANY_SELECT)
            .single();
          if (linkError) throw new Error(`company_register_link_failed: ${linkError.message}`);
          company = linked;
        }
      }
    } else if (organisationNumber) {
      const { data: ensuredId, error: ensureError } = await supabase.rpc(
        "ensure_company_for_employer",
        { p_organisasjonsnummer: organisationNumber },
      );
      if (ensureError || !ensuredId) {
        return jsonErr(
          ensureError?.code === "P0002" ? 404 : 500,
          "employer_resolve_failed",
          ensureError?.code === "P0002"
            ? "Fant ikke organisasjonsnummeret i registerspeilet."
            : "Kunne ikke koble arbeidsgiveren til registerspeilet.",
        );
      }
      const { data, error } = await supabase
        .from("companies").select(COMPANY_SELECT).eq("id", ensuredId).maybeSingle();
      if (error || !data) throw new Error(`ensured_company_missing: ${error?.message ?? ensuredId}`);
      company = data;
    } else {
      const cleanName = String(name).trim();
      const domain = extractDomain(rawDomain ?? cleanName);
      if (domain) {
        const { data } = await supabase
          .from("companies").select(COMPANY_SELECT).ilike("domain", domain).limit(1).maybeSingle();
        if (data) company = data;
      }
      if (!company) {
        const { data } = await supabase
          .from("companies").select(COMPANY_SELECT).ilike("name", cleanName).limit(1).maybeSingle();
        if (data) company = data;
      }
      if (!company) {
        const { data: created, error: insErr } = await supabase
          .from("companies").insert({ name: cleanName, domain }).select(COMPANY_SELECT).single();
        if (insErr) {
          console.error("companies insert failed:", insErr);
          return jsonErr(
            500,
            "company_create_failed",
            insErr.message ?? "Kunne ikke opprette selskap i databasen.",
          );
        }
        company = created;
      }
    }

    if (!company) throw new Error("Failed to resolve company");

    const companyOrganisationNumber = normalizeOrganisationNumber(company.organisasjonsnummer);
    if (!registerContext && companyOrganisationNumber) {
      registerContext = await loadEmployerRegisterContext(supabase, companyOrganisationNumber);
    }

    // Ensure user_company_ratings row exists
    const { error: ratingUpsertErr } = await supabase
      .from("user_company_ratings")
      .upsert(
        { user_id: resolvedUserId, company_id: company.id, updated_at: new Date().toISOString() },
        { onConflict: "user_id,company_id", ignoreDuplicates: false },
      );
    if (ratingUpsertErr) {
      console.error("user_company_ratings upsert failed:", ratingUpsertErr);
      return jsonErr(
        500,
        "database_error",
        `Kunne ikke koble bruker til selskap: ${ratingUpsertErr.message}`,
        { detail: ratingUpsertErr.code },
      );
    }

    // Determine if company analysis is fresh (cache window)
    const ratedAtValue = company.employer_analysis_rated_at ?? company.ai_rated_at;
    const ratedAt = ratedAtValue ? new Date(ratedAtValue).getTime() : 0;
    const ageMs = Date.now() - ratedAt;
    const cacheMs = COMPANY_CACHE_DAYS * 24 * 60 * 60 * 1000;
    const registerSourceUpdatedAt = sourceUpdatedAtFromContext(registerContext);
    const analysisSourceUpdatedAt = typeof company.employer_analysis_source_updated_at === "string"
      ? company.employer_analysis_source_updated_at
      : null;
    const registerHasAdvanced = !!registerSourceUpdatedAt && (
      !analysisSourceUpdatedAt ||
      new Date(registerSourceUpdatedAt).getTime() > new Date(analysisSourceUpdatedAt).getTime()
    );
    const companyFresh =
      company.employer_analysis_version === 2 &&
      !!company.employer_analysis_rated_at &&
      ageMs < cacheMs &&
      !registerHasAdvanced &&
      !force;

    // Load profile (always — needed for candidate fit)
    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", resolvedUserId).maybeSingle();

    // Check if user already has a fit score (skip recompute unless forced or company refreshed)
    const { data: existingRating } = await supabase
      .from("user_company_ratings")
      .select("ai_candidate_fit_score")
      .eq("user_id", resolvedUserId).eq("company_id", company.id).maybeSingle();
    const userHasFit = existingRating?.ai_candidate_fit_score != null;

    const candidateFitOnlyFromBody =
      bodyCandidateFitOnly === true ||
      bodyCandidateFitOnly === "true" ||
      bodyFitOnly === true ||
      bodyFitOnly === "true";

    /** Skip company web research when only personal match is missing (or client requests fit-only). */
    const effectiveCandidateFitOnly =
      candidateFitOnlyFromBody ||
      (companyFresh && !userHasFit && !force);

    if (effectiveCandidateFitOnly && !company.employer_analysis_rated_at && !company.ai_rated_at) {
      return jsonErr(
        400,
        "company_ai_required",
        "Selskapet har ingen lagret AI-analyse ennå — kjør full analyse først.",
      );
    }

    let companyStatus: "cached" | "refreshed" | "pending" = "cached";
    let candidateStatus: "queued" | "skipped" = "skipped";

    const needsBackground = effectiveCandidateFitOnly
      ? true
      : (!companyFresh ? true : (!userHasFit || !!force));
    let jobId: string | null = null;
    let already_running = false;
    let rate_limited_wait = false;
    let retry_after_at: string | null = null;

    if (needsBackground) {
      candidateStatus = "queued";
      if (effectiveCandidateFitOnly) companyStatus = "cached";
      else if (!companyFresh) companyStatus = "pending";

      const { data: latestJob } = await supabase
        .from("employer_analysis_jobs")
        .select("id, status, retry_after_at")
        .eq("user_id", resolvedUserId)
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        latestJob?.status === "rate_limited" &&
        latestJob.retry_after_at &&
        new Date(latestJob.retry_after_at as string) > new Date()
      ) {
        rate_limited_wait = true;
        jobId = latestJob.id as string;
        retry_after_at = latestJob.retry_after_at as string;
      } else {
        const job = await getOrCreateEmployerJob(supabase, resolvedUserId, company.id);
        jobId = job.id;
        already_running = job.reused;

        if (!already_running) {
          runAnalysisBackground(
            runEmployerAnalysisPipeline(supabase, apiKey, {
              jobId: job.id,
              userId: resolvedUserId,
              company,
              registerContext,
              profile,
              companyFresh,
              userHasFit,
              force,
              candidateFitOnly: effectiveCandidateFitOnly,
            }),
          );
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: companyStatus,
        candidate_fit: candidateStatus,
        company_id: company.id,
        company_name: company.name,
        ai_rated_at: company.employer_analysis_rated_at ?? company.ai_rated_at,
        analysis_version: company.employer_analysis_version ?? null,
        organisasjonsnummer: company.organisasjonsnummer ?? null,
        register_context_used: !!registerContext,
        job_id: jobId,
        already_running: already_running || false,
        rate_limited_wait: rate_limited_wait || false,
        retry_after_at,
        message: rate_limited_wait ? RATE_LIMIT_USER_MESSAGE : undefined,
        candidate_fit_only: effectiveCandidateFitOnly || undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("analyze-company error:", err);
    return jsonErr(500, "internal_error", "Noe gikk galt under AI-analysen. Prøv igjen om litt.");
  }
});
