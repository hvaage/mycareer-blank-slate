// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildRegisterContextText,
  EMPLOYER_DIMENSIONS,
  enforceEvidenceReferences,
  financialsFromRegisterContext,
  isEvaluationPlatformSource,
  normalizeCandidateScenarioNotes,
  normalizeEmployerAnalysisV2,
  type AnalysisSource,
  userFacingAnalysisSources,
} from "./analysis-v2.ts";
import {
  estimateModelCostUsd,
  extractXaiResponseText,
  financialsFromResearchPack,
  hasRegisterFinancials,
  MODEL_PRICING_SNAPSHOT_DATE,
  type ModelUsage,
  normalizeEmployerResearchPack,
  type EmployerResearchPack,
} from "./research-v1.ts";

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

const COMPANY_SYSTEM_PROMPT = `You are a senior employer analyst. Produce a thorough, evidence-based employer profile for job seekers from the supplied structured research pack. Do not perform new web searches.

SOURCE OF TRUTH:
- The user message contains a LOCAL_REGISTER_CONTEXT from Karrierenmin's own Bronnoysund mirror and a pre-collected RESEARCH_PACK. Treat local legal-entity fields and financial figures as authoritative for that Norwegian organisation number.
- Use only evidence in those two inputs. Do not invent sources or replace local financial facts with web figures.
- Distinguish the selected Norwegian legal entity from its parent group whenever evidence concerns different scopes.

EVIDENCE RULES:
- A scored employer dimension requires at least two independent supporting evidence items from the research pack. If evidence is insufficient, use score=null and evidence_status="insufficient_evidence".
- Use source_ids from RESEARCH_PACK.evidence. Never invent a source id.
- Never convert missing evidence into a low score.

USER-FACING SOURCE LANGUAGE:
- User-facing narratives must NEVER name employee-review, reputation-rating or salary-comparison platforms. Use neutral phrases such as "uavhengige ansattvurderinger", "eksterne vurderingskilder" and "lønnssammenligningskilder".
- Do not quote, compare or repeat scores supplied by external review/rating platforms. They may only support KarrierenMin's independent assessment.
- Exact source URLs remain in RESEARCH_PACK.evidence for internal traceability. Do not repeat platform/domain names in any user-facing narrative field.

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
  "executive_summary": "<Norwegian evidence-based orientation, 120-200 words; do not repeat the detailed dimensions>",
  "key_findings": ["<4-6 concise Norwegian main findings>"],
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
  "supplemental_insights": {
    "esg_and_regulatory": {
      "evidence_status": "<sourced|inferred|insufficient_evidence>",
      "narrative": "<Norwegian ESG and regulatory assessment based on sustainability reporting when available>",
      "highlights": ["<concise Norwegian findings>"],
      "source_ids": []
    },
    "employee_sentiment_trend": {
      "evidence_status": "<sourced|inferred|insufficient_evidence>",
      "direction": "<improving|stable|declining|mixed|insufficient_evidence>",
      "narrative": "<Norwegian trend assessment; never name or quote platform scores>",
      "highlights": ["<concise Norwegian findings>"],
      "source_ids": []
    },
    "compensation_signals": {
      "evidence_status": "<sourced|inferred|insufficient_evidence>",
      "narrative": "<Norwegian compensation signals; prefer company disclosures, then official statistics; no platform names>",
      "highlights": ["<ranges or qualitative signals, never unsupported point estimates>"],
      "source_ids": []
    }
  },
  "overall_assessment": "<Norwegian general synthesis, 250-450 words; strengths, uncertainties and practical caveats, not candidate-specific>"
}

Return all eight employer dimensions exactly once and all five AI signals exactly once.`;

const RESEARCH_SYSTEM_PROMPT = `You collect and structure employer evidence for a separate senior analysis model.

Return ONLY JSON. Do not score the employer and do not make a final recommendation.

RESEARCH REQUIREMENTS:
- Use web_search repeatedly across official company/careers pages, annual reports, investor relations, regulators, reputable editorial media and independent employee evidence.
- Prefer primary and official sources. Keep the selected legal entity distinct from its parent group.
- Aim for at least 12 distinct credible HTTPS sources when available.
- Each evidence item must contain a short factual excerpt and fact_keys indicating which employer or AI dimensions it can support.
- Exact source URLs are required for traceability.
- Do not include names, emails, phone numbers or other personal contact details.
- Collect explicit evidence for all eight employer dimensions and all five AI-maturity dimensions.
- Also collect evidence for ESG/regulatory posture, employee-sentiment direction over time and compensation signals.
- For ESG, prioritize sustainability/annual reporting, regulators and material independent reporting.
- For employee sentiment, capture themes and direction rather than copying platform scores.
- For compensation, prefer the company's own published ranges or collective frameworks, then official wage statistics. Use review/salary platforms only as secondary internal evidence.

FINANCIAL FALLBACK:
- The user message states whether the local Bronnoysund mirror already has financial history.
- If local financial history exists, set financial_supplement.status="not_needed" and do not substitute web figures.
- If local financial history is missing, search official annual reports first, then investor-relations presentations, then other first-party/regulator sources.
- Use status="found" only when figures are tied to an explicit reporting period, currency and source_ids. Otherwise use "not_found".
- Never use commercial company aggregators as the financial source.

Return this exact shape:
{
  "company_scope": {
    "legal_entity_name": "<name>",
    "organisation_number": "<number or null>",
    "scope_note": "<Norwegian scope/parent-group caveat>"
  },
  "summary": "<Norwegian evidence summary>",
  "evidence": [
    {
      "id": 1,
      "url": "https://...",
      "category": "<official_company|official_register|annual_report|investor_relations|news_media|regulator|employee_reviews|salary_benchmark|other>",
      "title": "<source title>",
      "excerpt": "<short factual Norwegian excerpt>",
      "published_at": "<date/year or null>",
      "fact_keys": ["culture", "leadership", "ai_strategy_and_leadership"]
    }
  ],
  "financial_supplement": {
    "status": "<not_needed|found|not_found>",
    "source_type": "<annual_report|investor_relations|official_company|regulator|other|null>",
    "reporting_period": "<period or null>",
    "currency": "<currency or null>",
    "revenue": <number or null>,
    "operating_result": <number or null>,
    "annual_result": <number or null>,
    "equity": <number or null>,
    "debt": <number or null>,
    "assets": <number or null>,
    "narrative": "<Norwegian caveat>",
    "source_ids": [1]
  }
}`;

const CANDIDATE_FIT_SYSTEM_PROMPT = `Du er en senior jobbmatch-analytiker. Du får et ferdig selskapsnotat (kun generelle selskapsfakta) og en kandidatprofil. Ikke gjør nye nettsøk — bruk bare innholdet du får.

VIKTIG: Svar skal beskrive hvordan DENNE KANDIDATEN passer (eller ikke) til selskapet. Ikke gjenta selskapets generelle fakta som om det var en upersonlig bedriftsartikkel — koble eksplisitt til kandidatens mål, erfaring, preferanser og risiko.

Returner KUN et JSON-objekt (ingen markdown fences, ingen tekst utenfor JSON). I "fit_reasoning" kan du bruke markdown (avsnitt, **fet**, lister) for lesbarhet.

{
  "ai_candidate_fit_score": <tall 1.0–5.0 i 0.5-steg>,
  "fit_reasoning": "<Norwegian markdown, 12–22 setninger tilsvarende. Struktur: (1) Kort konklusjon (2) **Styrker** — punktliste eller avsnitt (3) **Gap / risiko** — hva bør kandidaten være obs på (4) **Anbefaling** — neste steg eller forbehold. Henvis til konkrete dimensjoner (kultur, økonomi, karriere, osv.) og kandidatens profil.>",
  "scenario_notes": ["<3-5 short, actionable Norwegian notes tied to this candidate's background, goals or preferences>"]
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

const SOURCE_CATEGORIES = new Set([
  "official_company",
  "official_register",
  "annual_report",
  "investor_relations",
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
    try {
      const hostname = new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
      if (!isEvaluationPlatformSource(source)) continue;
      const parts = hostname.split(".");
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
      const n = userFacingAnalysisSources(normalizeAnalysisSources(e.sources))
        .map((source) => source.url);
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

function normalizeUuid(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
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
    v2.supplemental_insights
      ? fmt("Tilleggsinnsikt", clampStr(JSON.stringify(v2.supplemental_insights), 4500))
      : null,
    fmt("Helhetsvurdering", clampStr(v2.overall_assessment, 3000)),
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

type DetailedModelCall = {
  text: string;
  usage: ModelUsage;
  durationMs: number;
};

async function callAnthropicDetailed(apiKey: string, body: any): Promise<DetailedModelCall> {
  const started = Date.now();
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
  const text = (json?.content ?? [])
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  return {
    text,
    usage: {
      inputTokens: Number(json?.usage?.input_tokens) || 0,
      outputTokens: Number(json?.usage?.output_tokens) || 0,
      webSearchRequests: Number(json?.usage?.server_tool_use?.web_search_requests) || 0,
    },
    durationMs: Date.now() - started,
  };
}

async function callAnthropic(apiKey: string, body: any): Promise<string> {
  return (await callAnthropicDetailed(apiKey, body)).text;
}

function xaiWebSearchCount(json: any): number {
  const usage = json?.server_side_tool_usage ?? json?.usage?.server_side_tool_usage ?? {};
  const direct = usage?.web_search ?? usage?.web_search_requests ?? usage?.SERVER_SIDE_TOOL_WEB_SEARCH;
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.max(0, direct);
  if (direct && typeof direct === "object") {
    return Number(direct.count ?? direct.requests) || 0;
  }
  return 0;
}

async function callXaiResearch(
  apiKey: string,
  model: string,
  userMessage: string,
): Promise<DetailedModelCall> {
  const started = Date.now();
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: `${RESEARCH_SYSTEM_PROMPT}\n\n${userMessage}`,
      }],
      tools: [{ type: "web_search" }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 429) {
      throw new AnthropicRateLimitError(raw.slice(0, 2000), parseRetryAfterMs(res, raw));
    }
    throw new Error(`xAI ${res.status}: ${raw.slice(0, 2000)}`);
  }
  const json = JSON.parse(raw);
  const text = extractXaiResponseText(json);
  if (!text) throw new Error("xAI response did not contain output text");
  return {
    text,
    usage: {
      inputTokens: Number(json?.usage?.input_tokens) || 0,
      outputTokens: Number(json?.usage?.output_tokens) || 0,
      webSearchRequests: xaiWebSearchCount(json),
    },
    durationMs: Date.now() - started,
  };
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
      investor_relations: "Investorinformasjon",
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
      "## Hovedfunn",
      "",
      ...(Array.isArray(v2.key_findings) ? v2.key_findings.map((item: string) => `- ${item}`) : []),
      v2.executive_summary ? `\n${v2.executive_summary}` : "",
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
      "## ESG og regulatorisk profil",
      "",
      v2.supplemental_insights?.esg_and_regulatory?.narrative || "_Utilstrekkelig grunnlag._",
      "",
      ...(v2.supplemental_insights?.esg_and_regulatory?.highlights ?? []).map(
        (item: string) => `- ${item}`,
      ),
      "",
      "## Trend i ansattomtaler",
      "",
      v2.supplemental_insights?.employee_sentiment_trend?.narrative || "_Utilstrekkelig grunnlag._",
      "",
      ...(v2.supplemental_insights?.employee_sentiment_trend?.highlights ?? []).map(
        (item: string) => `- ${item}`,
      ),
      "",
      "## Lønnssignaler",
      "",
      v2.supplemental_insights?.compensation_signals?.narrative || "_Utilstrekkelig grunnlag._",
      "",
      ...(v2.supplemental_insights?.compensation_signals?.highlights ?? []).map(
        (item: string) => `- ${item}`,
      ),
      "",
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
        : row.financials?.source_kind === "official_web_fallback"
        ? `Offisiell finansiell fallback fra ${row.financials?.source_type ?? "årsrapport eller investorinformasjon"}.`
        : "Ingen finansiell informasjon var tilgjengelig for denne analysen.",
      "",
      "## Helhetsvurdering",
      "",
      v2.overall_assessment || "_Ingen helhetsvurdering._",
      "",
      "## Ansvarsfraskrivelse",
      "",
      "Denne analysen er basert på offentlig tilgjengelig informasjon og webbasert research på analysetidspunktet. Scoren gjenspeiler en evidensbasert vurdering, men erstatter ikke direkte due diligence, samtaler med nåværende og tidligere ansatte eller profesjonell karriereveiledning. KarrierenMin.no gir ingen garantier for nøyaktighet, fullstendighet eller fortsatt gyldighet. Bruk analysen som ett av flere underlag i din ansettelsesbeslutning.",
    ];
    const sources = userFacingAnalysisSources(normalizeAnalysisSources(v2.sources));
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
    `# Arbeidsgiveranalyse — ${row.name ?? "Selskap"}`,
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
    "## Hovedfunn",
    "",
    row.ai_rating_notes ?? "_Ingen hovedfunn._",
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

type ResearchProvider = "anthropic" | "xai";

type AnalysisRunOptions = {
  runMode?: "production" | "benchmark";
  persist?: boolean;
  researchProvider?: ResearchProvider;
  researchModel?: string;
  analysisModel?: string;
  modelRunId?: string | null;
  benchmarkGroupId?: string | null;
};

const ALLOWED_RESEARCH_MODELS: Record<ResearchProvider, Set<string>> = {
  anthropic: new Set(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-6"]),
  xai: new Set(["grok-4.3"]),
};

function productionModelOptions(): Required<AnalysisRunOptions> {
  const requestedProvider = Deno.env.get("EMPLOYER_RESEARCH_PROVIDER") ?? "anthropic";
  const researchProvider: ResearchProvider = requestedProvider === "xai" ? "xai" : "anthropic";
  const requestedResearchModel = Deno.env.get("EMPLOYER_RESEARCH_MODEL") ??
    (researchProvider === "xai" ? "grok-4.3" : "claude-haiku-4-5");
  const researchModel = ALLOWED_RESEARCH_MODELS[researchProvider].has(requestedResearchModel)
    ? requestedResearchModel
    : researchProvider === "xai" ? "grok-4.3" : "claude-haiku-4-5";
  const requestedAnalysisModel = Deno.env.get("EMPLOYER_ANALYSIS_MODEL") ?? "claude-sonnet-4-6";
  return {
    runMode: "production",
    persist: true,
    researchProvider,
    researchModel,
    analysisModel: requestedAnalysisModel === "claude-sonnet-4-6"
      ? requestedAnalysisModel
      : "claude-sonnet-4-6",
    modelRunId: null,
    benchmarkGroupId: null,
  };
}

function benchmarkModelOptions(provider: unknown, model: unknown): Required<AnalysisRunOptions> | null {
  if (provider !== "anthropic" && provider !== "xai") return null;
  if (typeof model !== "string" || !ALLOWED_RESEARCH_MODELS[provider].has(model)) return null;
  return {
    runMode: "benchmark",
    persist: false,
    researchProvider: provider,
    researchModel: model,
    analysisModel: "claude-sonnet-4-6",
    modelRunId: null,
    benchmarkGroupId: null,
  };
}

async function runEmployerResearch(
  anthropicApiKey: string,
  company: any,
  registerContext: any,
  provider: ResearchProvider,
  model: string,
): Promise<{ pack: EmployerResearchPack; call: DetailedModelCall }> {
  const registerFinancialsAvailable = hasRegisterFinancials(registerContext);
  const userMessage = `Research employer: "${company.name}".

Known domain hint: ${company.domain ?? "none"}
Country / market hint: ${company.country ?? "unknown"}
Organisation number: ${company.organisasjonsnummer ?? "none"}
Local register has financial history: ${registerFinancialsAvailable ? "yes" : "no"}

LOCAL_REGISTER_CONTEXT:
${buildRegisterContextText(registerContext)}

Collect the evidence pack and return only the required JSON.`;

  let call: DetailedModelCall;
  if (provider === "xai") {
    const xaiKey = Deno.env.get("XAI_API_KEY");
    if (!xaiKey) throw new Error("XAI_API_KEY is required for the xAI benchmark provider");
    call = await callXaiResearch(xaiKey, model, userMessage);
  } else {
    call = await callAnthropicDetailed(anthropicApiKey, {
      model,
      max_tokens: 9000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  }

  const pack = normalizeEmployerResearchPack(parseJson(call.text), {
    companyName: company.name,
    organisationNumber: company.organisasjonsnummer ?? null,
    registerHasFinancials: registerFinancialsAvailable,
  });
  return { pack, call };
}

async function runCompanyAnalysis(
  supabase: any,
  apiKey: string,
  company: { id: string; name: string; domain: string | null; country?: string | null },
  registerContext: any,
  user_id: string,
  jobId?: string | null,
  options?: AnalysisRunOptions,
): Promise<any | null> {
  const selected = { ...productionModelOptions(), ...options } as Required<AnalysisRunOptions>;
  let modelRunId: string | null = selected.modelRunId;
  try {
    if (!modelRunId) {
      const { data: modelRun, error: modelRunError } = await supabase
        .from("employer_analysis_model_runs")
        .insert({
          company_id: company.id,
          requested_by: user_id,
          benchmark_group_id: selected.benchmarkGroupId,
          run_mode: selected.runMode,
          status: "running",
          research_provider: selected.researchProvider,
          research_model: selected.researchModel,
          analysis_provider: "anthropic",
          analysis_model: selected.analysisModel,
          pricing_snapshot_date: MODEL_PRICING_SNAPSHOT_DATE,
        })
        .select("id")
        .single();
      if (modelRunError || !modelRun?.id) {
        throw new Error(`model_run_create_failed: ${modelRunError?.message ?? "missing id"}`);
      }
      modelRunId = modelRun.id as string;
    }

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        status: "processing",
        current_step: "employer_evidence_collection",
        progress_percent: 15,
      });
    }

    const research = await runEmployerResearch(
      apiKey,
      company,
      registerContext,
      selected.researchProvider,
      selected.researchModel,
    );

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "employer_analysis_reasoning",
        progress_percent: 42,
      });
    }

    const analysisUserMessage = `Analyse employer: "${company.name}".

Organisation number: ${(company as any).organisasjonsnummer ?? "none"}

LOCAL_REGISTER_CONTEXT:
${buildRegisterContextText(registerContext)}

RESEARCH_PACK:
${JSON.stringify(research.pack, null, 2)}

Use only these inputs. Return only the JSON object specified in the system instructions.`;
    const analysisCall = await callAnthropicDetailed(apiKey, {
      model: selected.analysisModel,
      max_tokens: 12000,
      system: COMPANY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: analysisUserMessage }],
    });
    const parsed = parseJson(analysisCall.text) as any;
    const analysisSources = normalizeAnalysisSources(
      research.pack.evidence.map((source) => ({
        id: source.id,
        url: source.url,
        category: source.category,
      })),
    );
    const publicAnalysisSources = userFacingAnalysisSources(analysisSources);
    const analysisV2 = enforceEvidenceReferences(
      normalizeEmployerAnalysisV2(
        parsed,
        evaluationSourceBrandTokens(analysisSources),
      ),
      analysisSources.map((source) => source.id),
    );
    const registerFinancials = financialsFromRegisterContext(registerContext);
    const fallbackFinancials = registerFinancials ? null : financialsFromResearchPack(research.pack);
    const registerSourceUpdatedAt = sourceUpdatedAtFromContext(registerContext);
    const persistedAnalysisV2 = {
      ...analysisV2,
      sources: publicAnalysisSources,
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
      research_provenance: {
        schema_version: research.pack.schema_version,
        provider: selected.researchProvider,
        model: selected.researchModel,
        analysis_provider: "anthropic",
        analysis_model: selected.analysisModel,
        evidence_count: research.pack.evidence.length,
        financial_fallback_status: research.pack.financial_supplement.status,
        model_run_id: modelRunId,
      },
    };
    const now = new Date().toISOString();

    const researchCost = estimateModelCostUsd(
      selected.researchModel,
      research.call.usage,
      { anthropicWebSearch: selected.researchProvider === "anthropic" },
    );
    const analysisCost = estimateModelCostUsd(selected.analysisModel, analysisCall.usage);
    const estimatedCost = researchCost == null || analysisCost == null
      ? null
      : Math.round((researchCost + analysisCost) * 1_000_000) / 1_000_000;
    const scoredAiDimensions = Object.values(analysisV2.ai_maturity.signals)
      .filter((signal) => signal.score !== null).length;

    const { error: modelRunFinishError } = await supabase
      .from("employer_analysis_model_runs")
      .update({
        status: "success",
        research_input_tokens: research.call.usage.inputTokens,
        research_output_tokens: research.call.usage.outputTokens,
        analysis_input_tokens: analysisCall.usage.inputTokens,
        analysis_output_tokens: analysisCall.usage.outputTokens,
        web_search_requests: research.call.usage.webSearchRequests,
        research_duration_ms: research.call.durationMs,
        analysis_duration_ms: analysisCall.durationMs,
        estimated_cost_usd: estimatedCost,
        cost_estimate_complete: selected.researchProvider === "anthropic" && estimatedCost !== null,
        source_count: analysisSources.length,
        scored_employer_dimensions: analysisV2.overall.scored_dimensions,
        scored_ai_dimensions: scoredAiDimensions,
        financial_fallback_used: !!fallbackFinancials,
        result_snapshot: {
          analysis: persistedAnalysisV2,
          research_pack: research.pack,
        },
        finished_at: now,
      })
      .eq("id", modelRunId);
    if (modelRunFinishError) {
      throw new Error(`model_run_finish_failed: ${modelRunFinishError.message}`);
    }

    if (!selected.persist) {
      return {
        benchmark: true,
        model_run_id: modelRunId,
        employer_analysis_v2: persistedAnalysisV2,
        financials: registerFinancials ?? fallbackFinancials,
      };
    }

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "parsing_and_validating",
        progress_percent: 58,
      });
    }

    const { data: existing } = await supabase
      .from("companies")
      .select("research_log")
      .eq("id", company.id)
      .maybeSingle();
    const existingLog = Array.isArray(existing?.research_log) ? existing!.research_log : [];

    const sourcesArr = publicAnalysisSources.map((source) => source.url);

    const newLog = [
      ...existingLog,
      {
        at: now,
        by: user_id,
        status: "completed",
        via: "analyze-company",
        analysis_version: 2,
        sources: sourcesArr,
        source_categories: Array.from(new Set(publicAnalysisSources.map((source) => source.category))),
        dimensions: EMPLOYER_DIMENSIONS.map((dimension) => dimension.key),
        ai_maturity_signals: Object.keys(analysisV2.ai_maturity.signals),
        register_context_used: !!registerContext,
        organisasjonsnummer: (company as any).organisasjonsnummer ?? null,
        research_provider: selected.researchProvider,
        research_model: selected.researchModel,
        analysis_model: selected.analysisModel,
        model_run_id: modelRunId,
      },
    ].slice(-20);

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "writing_company_row",
        progress_percent: 66,
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
    if (registerFinancials ?? fallbackFinancials) {
      updatePayload.financials = registerFinancials ?? fallbackFinancials;
    }

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
        progress_percent: 74,
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
    if (modelRunId) {
      await supabase.from("employer_analysis_model_runs").update({
        status: "failed",
        error_summary: ((e as Error)?.message ?? "unknown").slice(0, 4000),
        finished_at: new Date().toISOString(),
      }).eq("id", modelRunId);
    }
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
    if (selected.persist) {
      await markAnalysisFailed(supabase, company.id, user_id, (e as Error)?.message ?? "unknown");
    }
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
          ai_candidate_scenario_notes: [],
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
    const scenarioNotes = normalizeCandidateScenarioNotes(parsed.scenario_notes);

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
          ai_candidate_scenario_notes: scenarioNotes,
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
        ai_candidate_scenario_notes: scenarioNotes,
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
      benchmark: bodyBenchmark,
      research_provider: bodyResearchProvider,
      research_model: bodyResearchModel,
      benchmark_group_id: bodyBenchmarkGroupId,
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

    const benchmarkRequested = bodyBenchmark === true || bodyBenchmark === "true";
    let benchmarkOptions: Required<AnalysisRunOptions> | null = null;
    if (benchmarkRequested) {
      if (!bodyCompanyId || bodyOrganisationNumber != null) {
        return jsonErr(
          400,
          "benchmark_company_id_required",
          "Benchmark krever en eksisterende company_id og endrer ikke selskapskoblinger.",
        );
      }
      const { data: isAdmin, error: adminError } = await supabase.rpc("has_role", {
        _user_id: resolvedUserId,
        _role: "admin",
      });
      if (adminError || isAdmin !== true) {
        return jsonErr(403, "admin_required", "Kun administrator kan starte modellbenchmark.");
      }
      benchmarkOptions = benchmarkModelOptions(bodyResearchProvider, bodyResearchModel);
      if (!benchmarkOptions) {
        return jsonErr(
          400,
          "invalid_benchmark_model",
          "Tillatte kombinasjoner er Anthropic Haiku 4.5/Sonnet 4.6 eller xAI Grok 4.3.",
        );
      }
      if (benchmarkOptions.researchProvider === "xai" && !Deno.env.get("XAI_API_KEY")) {
        return jsonErr(503, "xai_not_configured", "XAI_API_KEY er ikke konfigurert.");
      }
      if (bodyBenchmarkGroupId != null && !normalizeUuid(bodyBenchmarkGroupId)) {
        return jsonErr(400, "invalid_benchmark_group_id", "benchmark_group_id må være en UUID.");
      }
      benchmarkOptions.benchmarkGroupId = normalizeUuid(bodyBenchmarkGroupId) ?? crypto.randomUUID();
    }

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

    if (benchmarkOptions) {
      const { data: modelRun, error: modelRunError } = await supabase
        .from("employer_analysis_model_runs")
        .insert({
          company_id: company.id,
          requested_by: resolvedUserId,
          benchmark_group_id: benchmarkOptions.benchmarkGroupId,
          run_mode: "benchmark",
          status: "running",
          research_provider: benchmarkOptions.researchProvider,
          research_model: benchmarkOptions.researchModel,
          analysis_provider: "anthropic",
          analysis_model: benchmarkOptions.analysisModel,
          pricing_snapshot_date: MODEL_PRICING_SNAPSHOT_DATE,
        })
        .select("id")
        .single();
      if (modelRunError || !modelRun?.id) {
        return jsonErr(
          500,
          "benchmark_create_failed",
          "Kunne ikke opprette benchmarkkjøringen.",
        );
      }
      runAnalysisBackground(
        runCompanyAnalysis(
          supabase,
          apiKey,
          company,
          registerContext,
          resolvedUserId,
          null,
          { ...benchmarkOptions, modelRunId: modelRun.id },
        ),
      );
      return new Response(JSON.stringify({
        ok: true,
        status: "benchmark_queued",
        model_run_id: modelRun.id,
        company_id: company.id,
        research_provider: benchmarkOptions.researchProvider,
        research_model: benchmarkOptions.researchModel,
        analysis_model: benchmarkOptions.analysisModel,
        benchmark_group_id: benchmarkOptions.benchmarkGroupId,
      }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
