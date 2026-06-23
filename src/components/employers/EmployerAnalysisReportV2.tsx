/**
 * Delt arbeidsgiveranalyse V2 — brukes på offentlig og innlogget rute.
 *
 * Alt analyseinnhold er åpent ved første rendering (K2). Ingen accordion,
 * tabs, "vis mer", eller klikk for å lese detaljer.
 *
 * `mode="public"` skal aldri rendre `weighting.personal`.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Mail, Info, FileText, type LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  EmployerAnalysisViewEnvelope,
  EmployerAnalysisV2,
  AnalysisDimension,
  AiSignal,
  SupplementalInsight,
} from "@/lib/queries/employer-analysis-view";
import {
  EmployerDimensionsRadarV2,
  type RadarDim,
} from "./EmployerDimensionsRadarV2";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";

// ---- konstanter ----

const DIMENSION_LABEL_FALLBACK: Record<string, string> = {
  culture: "Kultur og verdier",
  leadership: "Ledelseskvalitet",
  work_environment: "Arbeidsmiljø",
  career_development: "Karriereutvikling",
  financial_stability: "Finansiell stabilitet",
  mission: "Misjon og formål",
  talent_attraction_retention: "Rekruttering og retensjon",
  diversity_inclusion: "Mangfold og inkludering",
};

const DIMENSION_ORDER: string[] = [
  "culture",
  "leadership",
  "work_environment",
  "career_development",
  "financial_stability",
  "mission",
  "talent_attraction_retention",
  "diversity_inclusion",
];

const AI_SIGNAL_ORDER: string[] = [
  "strategy_and_leadership",
  "capability_and_deployment",
  "workforce",
  "governance",
  "market_and_product",
];

const AI_SIGNAL_LABEL_FALLBACK: Record<string, string> = {
  strategy_and_leadership: "Strategi og lederskap",
  capability_and_deployment: "Kapabilitet og distribusjon",
  workforce: "Arbeidsstyrke",
  governance: "Styring og ansvarlig bruk",
  market_and_product: "Marked og produkt",
};

const EVIDENCE_LABEL: Record<string, string> = {
  sourced: "Kildebelagt",
  inferred: "Avledet",
  insufficient: "Utilstrekkelig grunnlag",
  insufficient_evidence: "Utilstrekkelig grunnlag",
};

const DIRECTION_LABEL: Record<string, string> = {
  improving: "Forbedring",
  stable: "Stabil",
  declining: "Fallende",
  mixed: "Blandet",
  insufficient_evidence: "Utilstrekkelig grunnlag",
};

const FINANCIAL_SOURCE_LABEL: Record<string, string> = {
  brreg_local_mirror: "Lokalt speil av Brønnøysundregistrene",
  official_web_fallback: "Offisiell årsrapport eller investorinformasjon",
};

// ---- formatters ----

const nbInt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
const nbScoreOne = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const nbScoreTwo = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const nbPercent = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtTotalScore(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return nbScoreTwo.format(n);
}

function fmtDimScore(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return nbScoreOne.format(n);
}

function fmtAmount(n: number | null | undefined, currency: string | null): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
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

function fmtPct(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${nbPercent.format(n)} %`;
}

// ---- helpers ----

function orderedDimensions(dims: AnalysisDimension[]): AnalysisDimension[] {
  const byKey = new Map(dims.map((d) => [d.key, d]));
  // K-låst inventar: returnér ALLTID nøyaktig de åtte dimensjonene i fast
  // rekkefølge, og syntetiser placeholder for manglende. Ukjente nøkler i
  // payload ignoreres slik at tekniske navn ikke kan lekke til UI.
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

function orderedAiSignals(
  signals: EmployerAnalysisV2["ai_maturity"] extends infer T
    ? T extends { signals: infer S }
      ? S
      : never
    : never,
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

// ---- presentation primitives ----

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2">
          {Icon ? <Icon className="h-5 w-5 text-primary" aria-hidden /> : null}
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function EvidenceBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const label = EVIDENCE_LABEL[status] ?? "Utilstrekkelig grunnlag";
  const tone =
    status === "sourced"
      ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-500/30"
      : status === "inferred"
        ? "bg-amber-500/10 text-amber-900 dark:text-amber-100 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function SourceRefs({
  ids,
  sources,
}: {
  ids: number[] | null | undefined;
  sources: EmployerAnalysisV2["sources"];
}) {
  if (!ids || ids.length === 0) return null;
  const known = new Map(sources.map((s) => [s.id, s]));
  const refs = ids
    .map((id) => known.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (refs.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Kilder:{" "}
      {refs.map((s, i) => (
        <span key={s.id}>
          {i > 0 ? ", " : ""}
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
            title={s.url}
          >
            [{s.id}]
          </a>
        </span>
      ))}
    </p>
  );
}

function ScorePill({
  value,
  label,
  hint,
  size = "md",
}: {
  value: number | null | undefined;
  label: string;
  hint?: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-card ${
        size === "lg" ? "p-4" : "p-3"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`${
            size === "lg" ? "text-4xl" : "text-2xl"
          } font-bold tabular-nums text-foreground`}
        >
          {fmtTotalScore(value)}
        </span>
        <span className="text-sm text-muted-foreground">/ 5,00</span>
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function DimensionScoreBar({
  label,
  score,
}: {
  label: string;
  score: number | null;
}) {
  const pct =
    typeof score === "number" && !Number.isNaN(score)
      ? Math.max(0, Math.min(100, (score / 5) * 100))
      : 0;
  const hasScore = typeof score === "number" && !Number.isNaN(score);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {hasScore ? `${fmtDimScore(score)} / 5,0` : "Ikke nok data"}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${hasScore ? "bg-primary" : "bg-transparent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MarkdownText({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-2 prose-li:my-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

// ---- main component ----

export type EmployerAnalysisReportV2Props = {
  envelope: EmployerAnalysisViewEnvelope;
  mode: "public" | "authenticated";
  jobStatusSlot?: ReactNode;
  candidateMatchSlot?: ReactNode;
  /**
   * Når false: dropper navn/orgnr/sted/bransje i ReportTop. Brukes på offentlig
   * rute der route-headeren allerede viser dette. Default true.
   */
  showCompanyHeader?: boolean;
};

export function EmployerAnalysisReportV2({
  envelope,
  mode,
  jobStatusSlot,
  candidateMatchSlot,
  showCompanyHeader = true,
}: EmployerAnalysisReportV2Props) {
  const { company, analysis, weighting, financials, register } = envelope;

  // K3: kun authenticated mode skal noensinne røre weighting.personal.
  const personal = mode === "authenticated" ? weighting?.personal ?? null : null;
  const publicWeighting = weighting?.public ?? null;

  const ratedAt = company.analysis_rated_at;
  const hasAnalysis =
    analysis !== null && analysis !== undefined && !!ratedAt;

  // Empty state
  if (!hasAnalysis || !analysis) {
    return (
      <div className="space-y-4">
        {showCompanyHeader ? (
          <header className="space-y-1">
            <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">
              {company.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Organisasjonsnummer{" "}
              <span className="tabular-nums">{envelope.organisasjonsnummer}</span>
            </p>
          </header>
        ) : null}
        {jobStatusSlot}
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            Ingen arbeidsgiveranalyse tilgjengelig
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Det er ennå ikke generert en evidensbasert arbeidsgiveranalyse for
            dette selskapet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <ReportTop
        envelope={envelope}
        jobStatusSlot={jobStatusSlot}
        ratedAt={ratedAt}
        showCompanyHeader={showCompanyHeader}
      />

      <KeyFindings analysis={analysis} />

      <DimensionsOverview
        analysis={analysis}
        publicWeighting={publicWeighting}
        personal={personal}
      />

      <DimensionsDetail analysis={analysis} />

      <FinancialOverview financials={financials} register={register} />

      <SupplementalSections analysis={analysis} />

      <AiMaturitySection
        analysis={analysis}
        publicWeighting={publicWeighting}
        personal={personal}
      />

      {mode === "authenticated" && candidateMatchSlot ? (
        <Section title="Din kandidatmatch">{candidateMatchSlot}</Section>
      ) : null}

      <OverallAssessment analysis={analysis} />

      <SourcesSection analysis={analysis} />

      <ReportFooter envelope={envelope} />
    </div>
  );
}

// ---- subsections ----

function ReportTop({
  envelope,
  jobStatusSlot,
  ratedAt,
  showCompanyHeader,
}: {
  envelope: EmployerAnalysisViewEnvelope;
  jobStatusSlot?: ReactNode;
  ratedAt: string | null;
  showCompanyHeader: boolean;
}) {
  const { company, register } = envelope;
  const entity = register?.entity ?? null;
  const sted = [entity?.municipality, entity?.county].filter(Boolean).join(", ");
  const bransje = entity?.industry_primary ?? company.industry ?? null;
  if (!showCompanyHeader) {
    if (!jobStatusSlot) return null;
    return (
      <header className="space-y-3">
        <div>{jobStatusSlot}</div>
      </header>
    );
  }
  return (
    <header className="space-y-3">
      <div className="space-y-1">
        <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
          {company.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Organisasjonsnummer{" "}
          <span className="tabular-nums">{envelope.organisasjonsnummer}</span>
          {sted ? <> · {sted}</> : null}
          {bransje ? <> · {bransje}</> : null}
        </p>
        {ratedAt ? (
          <p className="text-xs text-muted-foreground">
            Analyse oppdatert {fmtDate(ratedAt)}
          </p>
        ) : null}
      </div>
      {jobStatusSlot ? <div>{jobStatusSlot}</div> : null}
    </header>
  );
}

function KeyFindings({ analysis }: { analysis: EmployerAnalysisV2 }) {
  const findings = (analysis.key_findings ?? []).filter(
    (f): f is string => typeof f === "string" && f.trim().length > 0,
  );
  return (
    <Section title="Hovedfunn">
      {findings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      ) : null}
      {analysis.executive_summary ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
          <MarkdownText>{analysis.executive_summary}</MarkdownText>
        </div>
      ) : null}
    </Section>
  );
}

function DimensionsOverview({
  analysis,
  publicWeighting,
  personal,
}: {
  analysis: EmployerAnalysisV2;
  publicWeighting: NonNullable<EmployerAnalysisViewEnvelope["weighting"]>["public"];
  personal: NonNullable<EmployerAnalysisViewEnvelope["weighting"]>["personal"];
}) {
  const ordered = useMemo(() => orderedDimensions(analysis.dimensions), [analysis.dimensions]);
  const radarData: RadarDim[] = ordered.map((d) => ({
    label: d.label,
    score: typeof d.score === "number" && !Number.isNaN(d.score) ? d.score : null,
  }));
  const coverage = publicWeighting?.employer?.weight_coverage_percent ?? null;
  const scored = publicWeighting?.employer?.scored_dimensions ?? null;
  const total = publicWeighting?.employer?.total_dimensions ?? ordered.length;
  return (
    <Section title="Dimensjonsscore av selskapet">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div className="text-primary">
          <EmployerDimensionsRadarV2 dimensions={radarData} />
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ScorePill
              size="lg"
              label="Felles vektet vurdering"
              value={publicWeighting?.employer?.score ?? null}
              hint={
                scored !== null
                  ? `${scored} av ${total} dimensjoner scoret`
                  : undefined
              }
            />
            {personal ? (
              <ScorePill
                size="lg"
                label="Din vektede vurdering"
                value={personal.employer?.score ?? null}
                hint={
                  personal.is_customized
                    ? "Basert på dine egne vekter"
                    : "Standardvekter — du har ikke tilpasset"
                }
              />
            ) : null}
          </div>
          {coverage !== null ? (
            <p className="text-xs text-muted-foreground">
              Vektdekning: {nbPercent.format(coverage)} %.
            </p>
          ) : null}
          <div className="space-y-3">
            {ordered.map((d) => (
              <DimensionScoreBar key={d.key} label={d.label} score={d.score} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function DimensionsDetail({ analysis }: { analysis: EmployerAnalysisV2 }) {
  const ordered = useMemo(() => orderedDimensions(analysis.dimensions), [analysis.dimensions]);
  return (
    <Section title="Detaljert gjennomgang av åtte dimensjoner">
      <div className="space-y-5">
        {ordered.map((d) => (
          <article
            key={d.key}
            className="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-foreground">{d.label}</h3>
              <div className="flex items-center gap-2">
                <EvidenceBadge status={d.evidence_status} />
                <span className="text-sm tabular-nums text-muted-foreground">
                  {typeof d.score === "number" && !Number.isNaN(d.score)
                    ? `${fmtDimScore(d.score)} / 5,0`
                    : "Ikke nok data"}
                </span>
              </div>
            </header>
            {d.rationale ? (
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                {d.rationale}
              </p>
            ) : null}
            {d.what_it_means ? (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Hva dette betyr for en jobbsøker
                </div>
                <p className="text-foreground leading-relaxed whitespace-pre-line">
                  {d.what_it_means}
                </p>
              </div>
            ) : null}
            <SourceRefs ids={d.source_ids} sources={analysis.sources} />
          </article>
        ))}
      </div>
    </Section>
  );
}

function FinancialOverview({
  financials,
  register,
}: {
  financials: EmployerAnalysisViewEnvelope["financials"];
  register: EmployerAnalysisViewEnvelope["register"];
}) {
  if (!financials || !financials.fiscal_year) {
    return (
      <Section title="Finansielle nøkkeltall">
        <p className="text-sm text-muted-foreground">
          Ingen regnskapsdata tilgjengelig.
        </p>
      </Section>
    );
  }
  const currency = financials.currency ?? "NOK";
  const sourceLabel =
    financials.source_kind && FINANCIAL_SOURCE_LABEL[financials.source_kind]
      ? FINANCIAL_SOURCE_LABEL[financials.source_kind]
      : financials.source_kind ?? null;
  const employees = register?.entity?.employee_count ?? null;
  const cells: Array<{ label: string; value: string }> = [
    { label: "Driftsinntekter", value: fmtAmount(financials.revenue_latest, currency) },
    {
      label: "Driftsresultat",
      value: fmtAmount(financials.operating_result_latest, currency),
    },
    { label: "Årsresultat", value: fmtAmount(financials.profit_latest, currency) },
    { label: "Egenkapital", value: fmtAmount(financials.equity_latest, currency) },
    { label: "Gjeld", value: fmtAmount(financials.debt_latest, currency) },
    { label: "Eiendeler", value: fmtAmount(financials.assets_latest, currency) },
    { label: "Driftsmargin", value: fmtPct(financials.operating_margin_percent) },
    { label: "Egenkapitalandel", value: fmtPct(financials.equity_ratio_percent) },
    {
      label: "Ansatte",
      value: typeof employees === "number" ? nbInt.format(employees) : "—",
    },
  ];
  return (
    <Section
      title="Finansielle nøkkeltall"
      description={`Regnskapsår ${financials.fiscal_year}.`}
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-foreground">
              {c.value}
            </div>
          </div>
        ))}
      </div>
      {sourceLabel ? (
        <p className="text-xs text-muted-foreground">Kilde: {sourceLabel}.</p>
      ) : null}
    </Section>
  );
}

function SupplementalBlock({
  title,
  insight,
  sources,
}: {
  title: string;
  insight: SupplementalInsight | null | undefined;
  sources: EmployerAnalysisV2["sources"];
}) {
  if (!insight) return null;
  return (
    <article className="rounded-lg border border-border bg-card p-4 space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <EvidenceBadge status={insight.evidence_status} />
      </header>
      {insight.direction ? (
        <p className="text-xs text-muted-foreground">
          Retning: <span className="font-medium text-foreground">{insight.direction}</span>
        </p>
      ) : null}
      {insight.narrative ? (
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
          {insight.narrative}
        </p>
      ) : null}
      {insight.highlights && insight.highlights.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {insight.highlights.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : null}
      <SourceRefs ids={insight.source_ids} sources={sources} />
    </article>
  );
}

function SupplementalSections({ analysis }: { analysis: EmployerAnalysisV2 }) {
  const supp = analysis.supplemental_insights ?? null;
  return (
    <Section title="ESG, ansatttrend og lønnssignaler">
      <div className="space-y-4">
        <SupplementalBlock
          title="ESG og regulatorisk profil"
          insight={supp?.esg_and_regulatory ?? null}
          sources={analysis.sources}
        />
        <SupplementalBlock
          title="Trend i ansattomtaler"
          insight={supp?.employee_sentiment_trend ?? null}
          sources={analysis.sources}
        />
        <SupplementalBlock
          title="Lønnssignaler"
          insight={supp?.compensation_signals ?? null}
          sources={analysis.sources}
        />
      </div>
    </Section>
  );
}

function AiMaturitySection({
  analysis,
  publicWeighting,
  personal,
}: {
  analysis: EmployerAnalysisV2;
  publicWeighting: NonNullable<EmployerAnalysisViewEnvelope["weighting"]>["public"];
  personal: NonNullable<EmployerAnalysisViewEnvelope["weighting"]>["personal"];
}) {
  const ai = analysis.ai_maturity;
  if (!ai) {
    return (
      <Section title="AI-kompetanse og modenhet">
        <p className="text-sm text-muted-foreground">Ingen AI-modenhetsvurdering.</p>
      </Section>
    );
  }
  const signals = orderedAiSignals(ai.signals as never);
  return (
    <Section title="AI-kompetanse og modenhet">
      <div className="grid gap-3 sm:grid-cols-2">
        <ScorePill
          size="lg"
          label="Felles vektet vurdering"
          value={publicWeighting?.ai?.score ?? null}
          hint={
            publicWeighting?.ai
              ? `${publicWeighting.ai.scored_dimensions} av ${publicWeighting.ai.total_dimensions} områder`
              : undefined
          }
        />
        {personal ? (
          <ScorePill
            size="lg"
            label="Din vektede vurdering"
            value={personal.ai?.score ?? null}
            hint={
              personal.is_customized
                ? "Basert på dine egne vekter"
                : "Standardvekter — du har ikke tilpasset"
            }
          />
        ) : null}
      </div>
      {ai.narrative ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
          <MarkdownText>{ai.narrative}</MarkdownText>
        </div>
      ) : null}
      <div className="space-y-4">
        {signals.map(({ key, signal }) => (
          <article
            key={key}
            className="rounded-lg border border-border bg-card p-4 space-y-2"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-foreground">
                {signal.label}
              </h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {typeof signal.score === "number" && !Number.isNaN(signal.score)
                  ? `${fmtDimScore(signal.score)} / 5,0`
                  : "Ikke nok data"}
              </span>
            </header>
            {signal.rationale ? (
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                {signal.rationale}
              </p>
            ) : null}
            <SourceRefs ids={signal.source_ids} sources={analysis.sources} />
          </article>
        ))}
      </div>
      <KeyEvidence evidence={ai.key_evidence} sources={analysis.sources} />
    </Section>
  );
}

function KeyEvidence({
  evidence,
  sources,
}: {
  evidence: unknown;
  sources: EmployerAnalysisV2["sources"];
}) {
  if (!evidence) return null;
  // Accept either string[] or array of {text, source_ids}
  if (Array.isArray(evidence) && evidence.length > 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sentral evidens
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {evidence.map((e, i) => {
            if (typeof e === "string") return <li key={i}>{e}</li>;
            if (e && typeof e === "object") {
              const obj = e as { text?: string; source_ids?: number[] };
              return (
                <li key={i} className="space-y-0.5">
                  {obj.text ? <span>{obj.text}</span> : null}
                  {obj.source_ids ? (
                    <SourceRefs ids={obj.source_ids} sources={sources} />
                  ) : null}
                </li>
              );
            }
            return null;
          })}
        </ul>
      </div>
    );
  }
  return null;
}

function OverallAssessment({ analysis }: { analysis: EmployerAnalysisV2 }) {
  if (!analysis.overall_assessment) return null;
  return (
    <Section title="Helhetsvurdering">
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
        <MarkdownText>{analysis.overall_assessment}</MarkdownText>
      </div>
    </Section>
  );
}

function SourcesSection({ analysis }: { analysis: EmployerAnalysisV2 }) {
  if (!analysis.sources || analysis.sources.length === 0) {
    return null;
  }
  return (
    <Section title="Kilder">
      <ol className="space-y-1 text-sm">
        {analysis.sources.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2">
            <span className="tabular-nums text-muted-foreground">[{s.id}]</span>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1 break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              {s.url}
            </a>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ReportFooter({ envelope }: { envelope: EmployerAnalysisViewEnvelope }) {
  const subject = encodeURIComponent(
    `Eierskap til arbeidsgiverprofil - ${envelope.company.name} (${envelope.organisasjonsnummer})`,
  );
  const mailto = `mailto:hei@karrierenmin.no?subject=${subject}`;
  return (
    <footer className="border-t border-border pt-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        <DisclaimerDialog />
        <MethodDialog />
        <Button asChild variant="outline" size="sm">
          <a href={mailto}>
            <Mail className="h-4 w-4" aria-hidden />
            Representerer du selskapet?
          </a>
        </Button>
      </div>
    </footer>
  );
}

function DisclaimerDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info className="h-4 w-4" aria-hidden />
          Ansvarsfraskrivelse
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ansvarsfraskrivelse</DialogTitle>
          <DialogDescription>
            Hvordan denne analysen skal brukes.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-foreground">
          Denne analysen er basert på offentlig tilgjengelig informasjon og
          webbasert research på analysetidspunktet. Scoren gjenspeiler en
          evidensbasert vurdering, men erstatter ikke direkte due diligence,
          samtaler med nåværende og tidligere ansatte eller profesjonell
          karriereveiledning. KarrierenMin.no gir ingen garantier for
          nøyaktighet, fullstendighet eller fortsatt gyldighet. Bruk analysen
          som ett av flere underlag i din ansettelsesbeslutning.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function MethodDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="h-4 w-4" aria-hidden />
          Metode og definisjoner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Metode og definisjoner</DialogTitle>
          <DialogDescription>Skala, evidens og scope.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-foreground">
          <div>
            <p className="font-medium">Geografisk og juridisk scope</p>
            <p className="text-muted-foreground">
              Norsk juridisk enhet identifisert ved organisasjonsnummer. Global
              kontekst trekkes inn der det er relevant for vurderingen.
            </p>
          </div>
          <div>
            <p className="font-medium">Skala 1–5</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>1: vesentlig bekymring med konkret evidens</li>
              <li>2: under gjennomsnitt, flere svake signaler</li>
              <li>3: nøytral baselinje eller blandet evidens</li>
              <li>4: over gjennomsnitt, flere støttende signaler</li>
              <li>
                5: sterk og godt dokumentert på tvers av uavhengige kilder
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium">Evidensstatus</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Kildebelagt</span>:
                direkte støttet av evidens.
              </li>
              <li>
                <span className="font-medium text-foreground">Avledet</span>:
                logisk utledet fra indirekte signaler.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Utilstrekkelig grunnlag
                </span>
                : færre enn to uavhengige kilder for en scoret dimensjon.
              </li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Totalscore renormaliseres over dimensjoner som faktisk har score.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
