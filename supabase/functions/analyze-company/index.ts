// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const COMPANY_SYSTEM_PROMPT = `You are a senior company research analyst with web_search. Produce a thorough, evidence-based employer profile suitable for job seekers. All factual claims about the company must be tied to sources you list.

RESEARCH DEPTH (mandatory):
- Call web_search multiple times with different queries (official site, news, LinkedIn company, reviews, industry/regulator, financials) before composing the final JSON.
- Aim for at least 12 distinct, credible https URLs in "sources" (no duplicates). Prefer primary sources (company domain, investor relations, annual reports), then reputable news, then review/employer platforms where relevant.
- For each dimension, synthesize several findings; do not rely on a single page.

FINANCIAL STABILITY — NORWEGIAN COMPANIES (MANDATORY): For companies registered in Norway, including Norwegian subsidiaries of foreign groups (country=NO, .no domain, Norwegian org.nr., or clearly Norwegian name), you MUST consult proff.no. Search "site:proff.no <company name>" and/or visit https://www.proff.no/selskap/<navn>. Extract regnskapstall (revenue trend last 2-3 years, profit/EBITDA, equity ratio in %, any payment remarks/betalingsanmerkninger). Base ai_financial_stability_score on this evidence and populate the "financials" object below. Cite the exact proff.no URL in sources. Supplement with brreg.no when relevant. If proff.no truly has no record, set financials.source_url to null and explain in financials.notes.

LANGUAGE: Write ai_rating_notes and every ai_dimension_notes value in Norwegian (bokmål). Keep company-level content only — do NOT personalize for an individual candidate here (no "du" as job seeker; neutral third person about the employer).

Return ONLY a JSON object with this exact structure (no markdown fences, no other text):

{
  "ai_culture_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_leadership_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_work_environment_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_career_development_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_financial_stability_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_mission_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_overall_score": <mean of the six scores above>,
  "ai_rating_notes": "<Norwegian: 500-900 words max. Multi-paragraph executive summary: strategy, culture, risks, opportunities, hiring signals, controversies if evidenced, and what a candidate should verify. Use markdown headings (##) and bullet lists where helpful.>",
  "ai_dimension_notes": {
    "culture": "<Norwegian: 8-14 sentences. Evidence, trade-offs, what is uncertain.>",
    "leadership": "<Norwegian: 8-14 sentences>",
    "work_environment": "<Norwegian: 8-14 sentences>",
    "career_development": "<Norwegian: 8-14 sentences>",
    "financial_stability": "<Norwegian: 8-14 sentences; include proff.no figures when NO>",
    "mission": "<Norwegian: 8-14 sentences>"
  },
  "financials": {
    "fiscal_year": <year as number or null>,
    "revenue_latest": "<f.eks. '125 MNOK' eller null>",
    "revenue_trend": "<f.eks. 'voksende +12%/år' eller null>",
    "profit_latest": "<f.eks. '8 MNOK' eller null>",
    "equity_ratio": "<f.eks. '42%' eller null>",
    "payment_remarks": "<'ingen' eller beskrivelse>",
    "source_url": "<proff.no URL eller null>",
    "notes": "<Norwegian: optional deeper commentary on financial health, max ~400 words>"
  },
  "sources": ["<minimum 12 unique https URLs when possible; include diversity of domains>"]
}

Scale: 1.0 = significant concern or no evidence, 3.0 = average, 5.0 = strong and well-evidenced.`;

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

function normalizeSourceUrls(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of sources) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!/^https?:\/\//i.test(t)) continue;
    const low = t.split("?")[0].split("#")[0].toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(t);
  }
  return out.slice(0, 40);
}

function ensureAiOverallScore(parsed: Record<string, unknown>): void {
  if (typeof parsed.ai_overall_score === "number" && !Number.isNaN(parsed.ai_overall_score)) return;
  const keys = [
    "ai_culture_score",
    "ai_leadership_score",
    "ai_work_environment_score",
    "ai_career_development_score",
    "ai_financial_stability_score",
    "ai_mission_score",
  ] as const;
  const dims = keys.map((k) => parsed[k]).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (dims.length === 6) {
    const mean = dims.reduce((a, b) => a + b, 0) / 6;
    parsed.ai_overall_score = Math.round(mean * 10) / 10;
  }
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

Before composing JSON: use web_search several times with varied queries (official careers/about, LinkedIn company, news last 24 months, employee reviews where relevant, industry/regulator, financial registry for locale). Minimum 12 unique https URLs in "sources" when credible material exists; diversify domains (not only the company homepage).

Return only the JSON object specified in the system instructions.`;
    const text = await callAnthropic(apiKey, {
      model: "claude-sonnet-4-6",
      max_tokens: 6656,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: COMPANY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const parsed = parseJson(text) as any;
    parsed.sources = normalizeSourceUrls(parsed.sources);
    ensureAiOverallScore(parsed);
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

    const isNorwegian =
      (company as any).country === "NO" ||
      (company.domain ?? "").toLowerCase().endsWith(".no") ||
      /\b(AS|ASA|ANS|DA|SA)\b/.test(company.name);
    const sourcesArr: string[] = normalizeSourceUrls(parsed.sources);
    const hasProff = sourcesArr.some((u) => /proff\.no/i.test(u)) ||
      (parsed.financials?.source_url && /proff\.no/i.test(parsed.financials.source_url));
    const proffMissing = isNorwegian && !hasProff;

    const newLog = [
      ...existingLog,
      {
        at: now,
        by: user_id,
        status: proffMissing ? "partial" : "completed",
        via: "analyze-company",
        sources: sourcesArr,
        dimensions: [
          "culture", "leadership", "work_environment",
          "career_development", "financial_stability", "mission",
        ],
        ...(proffMissing ? { warning: "proff_missing" } : {}),
      },
    ].slice(-20);

    if (jobId) {
      await updateEmployerJob(supabase, jobId, {
        current_step: "writing_company_row",
        progress_percent: 58,
      });
    }

    const { error: updErr } = await supabase
      .from("companies")
      .update({
        ai_culture_score: parsed.ai_culture_score,
        ai_leadership_score: parsed.ai_leadership_score,
        ai_work_environment_score: parsed.ai_work_environment_score,
        ai_career_development_score: parsed.ai_career_development_score,
        ai_financial_stability_score: parsed.ai_financial_stability_score,
        ai_mission_score: parsed.ai_mission_score,
        ai_overall_score: parsed.ai_overall_score,
        ai_rating_notes: parsed.ai_rating_notes,
        ai_dimension_notes: parsed.ai_dimension_notes ?? null,
        financials: parsed.financials ?? null,
        ai_rated_at: now,
        research_log: newLog,
        updated_at: now,
      })
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
    profile: any;
    companyFresh: boolean;
    userHasFit: boolean;
    force: boolean | undefined;
    candidateFitOnly?: boolean;
  },
) {
  const { jobId, userId, company, profile, companyFresh, candidateFitOnly } = ctx;
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
      const fresh = await runCompanyAnalysis(supabase, apiKey, company, userId, jobId);
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

    let resolvedUserId =
      typeof bodyUserId === "string" && bodyUserId.trim() ? bodyUserId.trim() : "";

    const authHeader = req.headers.get("Authorization");
    if (!resolvedUserId && authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authErr } = await userClient.auth.getUser();
      if (!authErr && authData?.user?.id) resolvedUserId = authData.user.id;
    }

    if (!resolvedUserId) {
      return jsonErr(
        401,
        "user_id_required",
        "Logg inn på nytt, eller send user_id i forespørselen.",
      );
    }
    if (!bodyCompanyId && !name) {
      return jsonErr(
        400,
        "company_required",
        "Send company_id (UUID) eller name / company_name (selskapsnavn).",
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

    if (bodyCompanyId) {
      const { data } = await supabase
        .from("companies").select(COMPANY_SELECT).eq("id", bodyCompanyId).maybeSingle();
      if (!data) {
        return jsonErr(404, "company_not_found", "Fant ikke selskapet.");
      }
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
    const ratedAt = company.ai_rated_at ? new Date(company.ai_rated_at).getTime() : 0;
    const ageMs = Date.now() - ratedAt;
    const cacheMs = COMPANY_CACHE_DAYS * 24 * 60 * 60 * 1000;
    const companyFresh = !!company.ai_rated_at && ageMs < cacheMs && !force;

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
      (!!company.ai_rated_at && !userHasFit && !force);

    if (effectiveCandidateFitOnly && !company.ai_rated_at) {
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
        ai_rated_at: company.ai_rated_at,
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
