export const RESEARCH_SOURCE_CATEGORIES = [
  "official_company",
  "official_register",
  "annual_report",
  "investor_relations",
  "news_media",
  "regulator",
  "employee_reviews",
  "salary_benchmark",
  "other",
] as const;

export type ResearchSourceCategory = typeof RESEARCH_SOURCE_CATEGORIES[number];

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
};

export type EmployerResearchPack = {
  schema_version: 1;
  company_scope: {
    legal_entity_name: string;
    organisation_number: string | null;
    scope_note: string;
  };
  summary: string;
  evidence: Array<{
    id: number;
    url: string;
    category: ResearchSourceCategory;
    title: string;
    excerpt: string;
    published_at: string | null;
    fact_keys: string[];
  }>;
  financial_supplement: {
    status: "not_needed" | "found" | "not_found";
    source_type: "annual_report" | "investor_relations" | "official_company" | "regulator" | "other" | null;
    reporting_period: string | null;
    currency: string | null;
    revenue: number | null;
    operating_result: number | null;
    annual_result: number | null;
    equity: number | null;
    debt: number | null;
    assets: number | null;
    narrative: string;
    source_ids: number[];
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, max = 8000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function narrative(value: unknown, max = 8000): string {
  return text(value, max)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redigert e-post]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[redigert telefon]");
}

function nullableText(value: unknown, max = 200): string | null {
  const result = text(value, max);
  return result || null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)))
    .slice(0, max);
}

function sourceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)))
    .slice(0, 40);
}

function normalizeCategory(value: unknown): ResearchSourceCategory {
  return typeof value === "string" &&
      (RESEARCH_SOURCE_CATEGORIES as readonly string[]).includes(value)
    ? value as ResearchSourceCategory
    : "other";
}

export function hasRegisterFinancials(registerContext: unknown): boolean {
  const root = record(registerContext);
  return Array.isArray(root.financial_history) && root.financial_history.length > 0;
}

export function normalizeEmployerResearchPack(
  value: unknown,
  options: {
    companyName: string;
    organisationNumber?: string | null;
    registerHasFinancials: boolean;
  },
): EmployerResearchPack {
  const root = record(value);
  const rawScope = record(root.company_scope);
  const rawEvidence = Array.isArray(root.evidence) ? root.evidence.map(record) : [];
  const evidence: EmployerResearchPack["evidence"] = [];
  const seenUrls = new Set<string>();
  const usedIds = new Set<number>();

  for (const raw of rawEvidence) {
    const url = text(raw.url, 2000);
    if (!/^https:\/\//i.test(url)) continue;
    const dedupeKey = url.split("?")[0].split("#")[0].toLowerCase();
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);

    const requestedId = Number(raw.id);
    let id = Number.isInteger(requestedId) && requestedId > 0 && !usedIds.has(requestedId)
      ? requestedId
      : evidence.length + 1;
    while (usedIds.has(id)) id++;
    usedIds.add(id);

    evidence.push({
      id,
      url,
      category: normalizeCategory(raw.category),
      title: text(raw.title, 300),
      excerpt: narrative(raw.excerpt, 1800),
      published_at: nullableText(raw.published_at, 40),
      fact_keys: stringArray(raw.fact_keys, 30),
    });
    if (evidence.length >= 40) break;
  }

  const rawFinancial = record(root.financial_supplement);
  const requestedStatus = text(rawFinancial.status, 30);
  const status: EmployerResearchPack["financial_supplement"]["status"] =
    options.registerHasFinancials
      ? "not_needed"
      : requestedStatus === "found"
        ? "found"
        : "not_found";
  const rawSourceType = text(rawFinancial.source_type, 40);
  const sourceType = [
      "annual_report",
      "investor_relations",
      "official_company",
      "regulator",
      "other",
    ].includes(rawSourceType)
    ? rawSourceType as EmployerResearchPack["financial_supplement"]["source_type"]
    : null;

  return {
    schema_version: 1,
    company_scope: {
      legal_entity_name: text(rawScope.legal_entity_name, 300) || options.companyName,
      organisation_number: nullableText(rawScope.organisation_number, 20) ??
        options.organisationNumber ?? null,
      scope_note: narrative(rawScope.scope_note, 1800),
    },
    summary: narrative(root.summary, 5000),
    evidence,
    financial_supplement: {
      status,
      source_type: status === "found" ? sourceType : null,
      reporting_period: status === "found" ? nullableText(rawFinancial.reporting_period, 80) : null,
      currency: status === "found" ? nullableText(rawFinancial.currency, 12) : null,
      revenue: status === "found" ? nullableNumber(rawFinancial.revenue) : null,
      operating_result: status === "found" ? nullableNumber(rawFinancial.operating_result) : null,
      annual_result: status === "found" ? nullableNumber(rawFinancial.annual_result) : null,
      equity: status === "found" ? nullableNumber(rawFinancial.equity) : null,
      debt: status === "found" ? nullableNumber(rawFinancial.debt) : null,
      assets: status === "found" ? nullableNumber(rawFinancial.assets) : null,
      narrative: status === "found" ? narrative(rawFinancial.narrative, 2400) : "",
      source_ids: status === "found" ? sourceIds(rawFinancial.source_ids) : [],
    },
  };
}

const PRICE_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "grok-4.3": { input: 1.25, output: 2.5 },
};

export const MODEL_PRICING_SNAPSHOT_DATE = "2026-06-23";

export function estimateModelCostUsd(
  model: string,
  usage: ModelUsage,
  options: { anthropicWebSearch?: boolean } = {},
): number | null {
  const price = PRICE_USD_PER_MILLION[model];
  if (!price) return null;
  const tokens = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  const webSearch = options.anthropicWebSearch ? usage.webSearchRequests * 0.01 : 0;
  return Math.round((tokens + webSearch) * 1_000_000) / 1_000_000;
}

export function financialsFromResearchPack(
  pack: EmployerResearchPack,
): JsonRecord | null {
  const financial = pack.financial_supplement;
  if (financial.status !== "found") return null;
  return {
    source_kind: "official_web_fallback",
    source_type: financial.source_type,
    reporting_period: financial.reporting_period,
    currency: financial.currency,
    revenue_latest: financial.revenue,
    operating_result_latest: financial.operating_result,
    profit_latest: financial.annual_result,
    equity_latest: financial.equity,
    debt_latest: financial.debt,
    assets_latest: financial.assets,
    notes: financial.narrative,
    source_ids: financial.source_ids,
  };
}

export function extractXaiResponseText(value: unknown): string {
  const root = record(value);
  if (typeof root.output_text === "string") return root.output_text.trim();
  if (!Array.isArray(root.output)) return "";
  const parts: string[] = [];
  for (const itemValue of root.output) {
    const item = record(itemValue);
    if (!Array.isArray(item.content)) continue;
    for (const contentValue of item.content) {
      const content = record(contentValue);
      if ((content.type === "output_text" || content.type === "text") && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}
