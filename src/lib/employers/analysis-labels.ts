/**
 * Delte etiketter og formatterere for arbeidsgiveranalysen.
 *
 * Brukes av både skjermvisningen (EmployerAnalysisReportV2) og PDF-eksporten,
 * slik at de to flatene alltid viser identiske tekster.
 */
import type {
  AiSignal,
  AnalysisDimension,
} from "@/lib/queries/employer-analysis-view";

export const DIMENSION_LABEL_FALLBACK: Record<string, string> = {
  culture: "Kultur og verdier",
  leadership: "Ledelseskvalitet",
  work_environment: "Arbeidsmiljø",
  career_development: "Karriereutvikling",
  financial_stability: "Finansiell stabilitet",
  mission: "Misjon og formål",
  talent_attraction_retention: "Rekruttering og retensjon",
  diversity_inclusion: "Mangfold og inkludering",
};

export const DIMENSION_ORDER: string[] = [
  "culture",
  "leadership",
  "work_environment",
  "career_development",
  "financial_stability",
  "mission",
  "talent_attraction_retention",
  "diversity_inclusion",
];

export const AI_SIGNAL_ORDER: string[] = [
  "strategy_and_leadership",
  "capability_and_deployment",
  "workforce",
  "governance",
  "market_and_product",
];

export const AI_SIGNAL_LABEL_FALLBACK: Record<string, string> = {
  strategy_and_leadership: "Strategi og lederskap",
  capability_and_deployment: "Kapabilitet og distribusjon",
  workforce: "Arbeidsstyrke",
  governance: "Styring og ansvarlig bruk",
  market_and_product: "Marked og produkt",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  sourced: "Kildebelagt",
  inferred: "Avledet",
  insufficient: "Utilstrekkelig grunnlag",
  insufficient_evidence: "Utilstrekkelig grunnlag",
};

export const DIRECTION_LABEL: Record<string, string> = {
  improving: "Forbedring",
  stable: "Stabil",
  declining: "Fallende",
  mixed: "Blandet",
  insufficient_evidence: "Utilstrekkelig grunnlag",
};

export const FINANCIAL_SOURCE_LABEL: Record<string, string> = {
  brreg_local_mirror: "Lokalt speil av Brønnøysundregistrene",
  official_web_fallback: "Offisiell årsrapport eller investorinformasjon",
};

export const NO_SCORE_LABEL = "Ikke nok data";

// ---- formatters ----

export const nbInt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
export const nbScoreOne = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const nbScoreTwo = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const nbPercent = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function hasScore(n: number | null | undefined): n is number {
  return typeof n === "number" && !Number.isNaN(n);
}

export function fmtTotalScore(n: number | null | undefined): string {
  if (!hasScore(n)) return "—";
  return nbScoreTwo.format(n);
}

export function fmtDimScore(n: number | null | undefined): string {
  if (!hasScore(n)) return "—";
  return nbScoreOne.format(n);
}

/** «4,1 / 5,0» eller «Ikke nok data» — aldri 0 når score mangler. */
export function fmtScoreOrMissing(n: number | null | undefined): string {
  return hasScore(n) ? `${fmtDimScore(n)} / 5,0` : NO_SCORE_LABEL;
}

export function fmtAmount(
  n: number | null | undefined,
  currency: string | null,
): string {
  if (!hasScore(n)) return "—";
  const abs = Math.abs(n);
  let value: string;
  let suffix = "";
  if (abs >= 1_000_000_000) {
    value = nbScoreOne.format(n / 1_000_000_000);
    suffix = " mrd.";
  } else if (abs >= 1_000_000) {
    value = nbScoreOne.format(n / 1_000_000);
    suffix = " mill.";
  } else {
    value = nbInt.format(n);
  }
  return `${value}${suffix}${currency ? ` ${currency}` : ""}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (!hasScore(n)) return "—";
  return `${nbPercent.format(n)} %`;
}

// ---- ordering ----

export function orderedDimensions(
  dims: AnalysisDimension[] | null | undefined,
): AnalysisDimension[] {
  const byKey = new Map((dims ?? []).map((d) => [d.key, d]));
  return DIMENSION_ORDER.map((key) => {
    const d = byKey.get(key);
    const fallbackLabel = DIMENSION_LABEL_FALLBACK[key] ?? key;
    if (!d) {
      return {
        key,
        label: fallbackLabel,
        score: null,
        rationale: null,
        what_it_means: null,
        source_ids: null,
        evidence_status: null,
      } as AnalysisDimension;
    }
    return { ...d, label: fallbackLabel };
  });
}

export function orderedAiSignals(
  signals: unknown,
): Array<{ key: string; signal: AiSignal }> {
  const map = (signals ?? {}) as Record<string, AiSignal | undefined>;
  return AI_SIGNAL_ORDER.map((key) => {
    const fallbackLabel = AI_SIGNAL_LABEL_FALLBACK[key] ?? key;
    const s = map[key];
    if (!s) {
      return {
        key,
        signal: {
          label: fallbackLabel,
          score: null,
          rationale: null,
          source_ids: null,
        },
      };
    }
    return { key, signal: { ...s, label: fallbackLabel } };
  });
}

/** Enkel markdown-avkledning for flatt PDF-tekstinnhold. */
export function markdownToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
