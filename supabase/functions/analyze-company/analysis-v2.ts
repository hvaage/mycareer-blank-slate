export const EMPLOYER_DIMENSIONS = [
  { key: "culture", label: "Kultur og verdier" },
  { key: "leadership", label: "Ledelseskvalitet" },
  { key: "work_environment", label: "Arbeidsmiljø" },
  { key: "career_development", label: "Karriereutvikling" },
  { key: "financial_stability", label: "Finansiell stabilitet" },
  { key: "mission", label: "Misjon og formål" },
  { key: "talent_attraction_retention", label: "Rekruttering og retensjon" },
  { key: "diversity_inclusion", label: "Mangfold og inkludering" },
] as const;

export const AI_MATURITY_SIGNALS = [
  { key: "strategy_and_leadership", label: "Strategi og lederskap" },
  { key: "capability_and_deployment", label: "Kapabilitet og distribusjon" },
  { key: "workforce", label: "Arbeidsstyrke" },
  { key: "governance", label: "Styring og ansvarlig bruk" },
  { key: "market_and_product", label: "Marked og produkt" },
] as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringArray(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function sourceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)))
    .slice(0, 40);
}

export function normalizeCandidateScenarioNotes(value: unknown): string[] {
  return stringArray(value, 5);
}

export function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.max(1, Math.min(5, value));
  return Math.round(clamped * 2) / 2;
}

const NEUTRAL_SOURCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bglassdoor(?:\.com)?\b/gi, "en ekstern ansattvurderingskilde"],
  [/\bjobbi(?:\.no)?\b/gi, "en ekstern ansattvurderingskilde"],
  [/\bindeed(?:\.com)?\b/gi, "en ekstern ansattvurderingskilde"],
  [/\bkununu(?:\.com)?\b/gi, "en ekstern ansattvurderingskilde"],
  [/\btrustpilot(?:\.com)?\b/gi, "en ekstern vurderingskilde"],
  [/\blevels\.?fyi\b/gi, "en ekstern lønnssammenligningskilde"],
  [/\bgreat place to work\b/gi, "en ekstern arbeidsplassvurdering"],
];

const USER_HIDDEN_SOURCE_HOST =
  /(^|\.)(glassdoor|jobbi|indeed|kununu|trustpilot|levels\.fyi|comparably|ambitionbox|greatplacetowork)(\.|$)/i;

export type AnalysisSource = { id: number; url: string; category: string };

export function isEvaluationPlatformSource(source: Pick<AnalysisSource, "url" | "category">): boolean {
  if (source.category === "employee_reviews" || source.category === "salary_benchmark") return true;
  try {
    return USER_HIDDEN_SOURCE_HOST.test(new URL(source.url).hostname.toLowerCase());
  } catch {
    return true;
  }
}

export function userFacingAnalysisSources<T extends AnalysisSource>(sources: T[]): T[] {
  return sources.filter((source) => !isEvaluationPlatformSource(source));
}

/**
 * User-facing analysis text must describe evidence categories, not advertise
 * named review or salary platforms. Source URLs remain untouched elsewhere for
 * internal traceability.
 */
export function neutralizeEvaluationPlatformNames(
  value: unknown,
  additionalBrandTokens: string[] = [],
): string {
  let result = text(value);
  for (const [pattern, replacement] of NEUTRAL_SOURCE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  for (const token of additionalBrandTokens) {
    const safe = token.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(safe)) continue;
    const escaped = safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`\\b${escaped}(?:\\.[a-z]{2,})?\\b`, "gi"),
      "en ekstern vurderingskilde",
    );
  }
  return result;
}

export type EmployerAnalysisV2 = {
  schema_version: 2;
  overall: {
    score: number | null;
    scored_dimensions: number;
    total_dimensions: 8;
  };
  executive_summary: string;
  key_findings: string[];
  dimensions: Array<{
    key: string;
    label: string;
    score: number | null;
    evidence_status: "sourced" | "inferred" | "insufficient_evidence";
    rationale: string;
    what_it_means: string;
    source_ids: number[];
  }>;
  ai_maturity: {
    applicable: boolean;
    applicability_note: string | null;
    score: number | null;
    narrative: string;
    signals: Record<string, {
      label: string;
      score: number | null;
      rationale: string;
      source_ids: number[];
    }>;
    key_evidence: string[];
    source_ids: number[];
  };
  supplemental_insights: {
    esg_and_regulatory: EvidenceInsight;
    employee_sentiment_trend: EvidenceInsight & {
      direction: "improving" | "stable" | "declining" | "mixed" | "insufficient_evidence";
    };
    compensation_signals: EvidenceInsight;
  };
  overall_assessment: string;
};

export type EvidenceInsight = {
  evidence_status: "sourced" | "inferred" | "insufficient_evidence";
  narrative: string;
  highlights: string[];
  source_ids: number[];
};

export function normalizeEmployerAnalysisV2(
  value: unknown,
  additionalBrandTokens: string[] = [],
): EmployerAnalysisV2 {
  const root = record(value);
  const neutralize = (input: unknown) =>
    neutralizeEvaluationPlatformNames(input, additionalBrandTokens);
  const rawDimensions = Array.isArray(root.dimensions) ? root.dimensions.map(record) : [];

  const dimensions = EMPLOYER_DIMENSIONS.map((definition) => {
    const raw = rawDimensions.find((item) => item.key === definition.key) ?? {};
    const rawStatus = text(raw.evidence_status);
    const normalizedScore = normalizeScore(raw.score);
    const status: "sourced" | "inferred" | "insufficient_evidence" =
      rawStatus === "sourced" || rawStatus === "inferred"
      ? rawStatus
      : "insufficient_evidence";
    const score = status === "insufficient_evidence" ? null : normalizedScore;
    return {
      key: definition.key,
      label: definition.label,
      score,
      evidence_status: score === null ? "insufficient_evidence" as const : status,
      rationale: neutralize(raw.rationale),
      what_it_means: neutralize(raw.what_it_means),
      source_ids: sourceIds(raw.source_ids),
    };
  });

  const scored = dimensions
    .map((item) => item.score)
    .filter((score): score is number => score !== null);
  const rawOverall = record(root.overall);
  const rawOverallNumber = typeof rawOverall.score === "number" && Number.isFinite(rawOverall.score)
    ? Math.round(Math.max(1, Math.min(5, rawOverall.score)) * 10) / 10
    : null;
  const overallScore = scored.length
    ? Math.round((scored.reduce((sum, score) => sum + score, 0) / scored.length) * 10) / 10
    : rawOverallNumber;

  const rawAi = record(root.ai_maturity ?? root.ai_maturity_posture);
  const applicable = rawAi.applicable !== false;
  const rawSignals = record(rawAi.signals);
  const signals: EmployerAnalysisV2["ai_maturity"]["signals"] = {};
  const presentAiScores: number[] = [];
  for (const definition of AI_MATURITY_SIGNALS) {
    const rawSignal = record(rawSignals[definition.key]);
    const score = applicable ? normalizeScore(rawSignal.score) : null;
    if (score !== null) presentAiScores.push(score);
    signals[definition.key] = {
      label: definition.label,
      score,
      rationale: neutralize(rawSignal.rationale ?? rawSignal.text),
      source_ids: sourceIds(rawSignal.source_ids),
    };
  }
  const rawAiScore = typeof rawAi.score === "number" && Number.isFinite(rawAi.score)
    ? Math.round(Math.max(1, Math.min(5, rawAi.score)) * 10) / 10
    : null;
  const aiScore = applicable
    ? presentAiScores.length
      ? Math.round((presentAiScores.reduce((sum, score) => sum + score, 0) / presentAiScores.length) * 10) / 10
      : rawAiScore
    : null;

  const rawSupplemental = record(root.supplemental_insights);
  const normalizeInsight = (value: unknown): EvidenceInsight => {
    const raw = record(value);
    const rawStatus = text(raw.evidence_status);
    const evidenceStatus: EvidenceInsight["evidence_status"] =
      rawStatus === "sourced" || rawStatus === "inferred"
        ? rawStatus
        : "insufficient_evidence";
    return {
      evidence_status: evidenceStatus,
      narrative: neutralize(raw.narrative),
      highlights: stringArray(raw.highlights, 8).map(neutralize),
      source_ids: sourceIds(raw.source_ids),
    };
  };
  const sentiment = normalizeInsight(rawSupplemental.employee_sentiment_trend);
  const rawDirection = text(record(rawSupplemental.employee_sentiment_trend).direction);
  const direction = ["improving", "stable", "declining", "mixed"].includes(rawDirection)
    ? rawDirection as "improving" | "stable" | "declining" | "mixed"
    : "insufficient_evidence" as const;

  return {
    schema_version: 2,
    overall: {
      score: overallScore,
      scored_dimensions: scored.length,
      total_dimensions: 8,
    },
    executive_summary: neutralize(
      root.executive_summary ?? root.ai_rating_notes,
    ),
    key_findings: stringArray(root.key_findings, 6)
      .map(neutralize),
    dimensions,
    ai_maturity: {
      applicable,
      applicability_note: applicable
        ? null
        : neutralize(rawAi.applicability_note) || null,
      score: aiScore,
      narrative: neutralize(rawAi.narrative),
      signals,
      key_evidence: stringArray(rawAi.key_evidence)
        .map(neutralize),
      source_ids: sourceIds(rawAi.source_ids),
    },
    supplemental_insights: {
      esg_and_regulatory: normalizeInsight(rawSupplemental.esg_and_regulatory),
      employee_sentiment_trend: { ...sentiment, direction },
      compensation_signals: normalizeInsight(rawSupplemental.compensation_signals),
    },
    overall_assessment: neutralize(root.overall_assessment ?? root.synthesis),
  };
}

export function enforceEvidenceReferences(
  analysis: EmployerAnalysisV2,
  validSourceIds: Iterable<number>,
): EmployerAnalysisV2 {
  const valid = new Set(validSourceIds);
  const dimensions = analysis.dimensions.map((dimension) => {
    const ids = dimension.source_ids.filter((id) => valid.has(id));
    const sufficientlySourced = dimension.score !== null && ids.length >= 2;
    return {
      ...dimension,
      score: sufficientlySourced ? dimension.score : null,
      evidence_status: sufficientlySourced
        ? dimension.evidence_status
        : "insufficient_evidence" as const,
      source_ids: ids,
    };
  });
  const employerScores = dimensions
    .map((dimension) => dimension.score)
    .filter((score): score is number => score !== null);

  const signals: EmployerAnalysisV2["ai_maturity"]["signals"] = {};
  const aiScores: number[] = [];
  for (const [key, signal] of Object.entries(analysis.ai_maturity.signals)) {
    const ids = signal.source_ids.filter((id) => valid.has(id));
    const score = signal.score !== null && ids.length >= 1 ? signal.score : null;
    if (score !== null) aiScores.push(score);
    signals[key] = { ...signal, score, source_ids: ids };
  }

  const enforceInsight = <T extends EvidenceInsight>(section: T, minimumSources: number): T => {
    const ids = section.source_ids.filter((id) => valid.has(id));
    const sufficientlySourced =
      section.evidence_status !== "insufficient_evidence" && ids.length >= minimumSources;
    return {
      ...section,
      evidence_status: sufficientlySourced
        ? section.evidence_status
        : "insufficient_evidence",
      source_ids: ids,
    };
  };

  return {
    ...analysis,
    overall: {
      ...analysis.overall,
      score: employerScores.length
        ? Math.round((employerScores.reduce((sum, score) => sum + score, 0) / employerScores.length) * 10) / 10
        : null,
      scored_dimensions: employerScores.length,
    },
    dimensions,
    ai_maturity: {
      ...analysis.ai_maturity,
      score: analysis.ai_maturity.applicable && aiScores.length
        ? Math.round((aiScores.reduce((sum, score) => sum + score, 0) / aiScores.length) * 10) / 10
        : null,
      signals,
      source_ids: analysis.ai_maturity.source_ids.filter((id) => valid.has(id)),
    },
    supplemental_insights: {
      esg_and_regulatory: enforceInsight(
        analysis.supplemental_insights.esg_and_regulatory,
        1,
      ),
      employee_sentiment_trend: enforceInsight(
        analysis.supplemental_insights.employee_sentiment_trend,
        2,
      ),
      compensation_signals: enforceInsight(
        analysis.supplemental_insights.compensation_signals,
        1,
      ),
    },
  };
}

export function buildRegisterContextText(value: unknown): string {
  if (!value || typeof value !== "object") return "Ingen lokal registerkontekst tilgjengelig.";
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length <= 24_000
    ? serialized
    : serialized.slice(0, 24_000) + "\n... (registerkontekst forkortet)";
}

export function financialsFromRegisterContext(value: unknown): JsonRecord | null {
  const root = record(value);
  const history = Array.isArray(root.financial_history)
    ? root.financial_history.map(record)
    : [];
  const latest = history[0];
  if (!latest) return null;
  return {
    source_kind: "brreg_local_mirror",
    organisasjonsnummer: text(root.organisasjonsnummer) || null,
    source_updated_at: text(root.source_updated_at) || null,
    fiscal_year: typeof latest.year === "number" ? latest.year : null,
    currency: text(latest.currency) || null,
    revenue_latest: latest.revenue ?? null,
    operating_result_latest: latest.operating_result ?? null,
    profit_latest: latest.annual_result ?? null,
    equity_latest: latest.equity ?? null,
    debt_latest: latest.debt ?? null,
    assets_latest: latest.assets ?? null,
    operating_margin_percent: latest.operating_margin_percent ?? null,
    equity_ratio_percent: latest.equity_ratio_percent ?? null,
    history,
  };
}
