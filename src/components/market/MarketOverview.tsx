import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Building2,
  MapPin,
  Target,
  Compass,
  GraduationCap,
  Lightbulb,
  Database,
  Sparkles,
  X,
  AlertCircle,
  Loader2,
  Info,
} from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cleanRegionLabel } from "@/lib/regions";
import {
  dedupeNeeds,
  isSelectedIndustry,
  isSelectedOccupation,
  isSelectedRegionResult,
  isUnmet,
  matchesNeedSignal,
  matchesRegion,
  norm,
  signalKind,
} from "@/lib/marketOverview";
import {
  supabase,
  hasValue,
  formatNumberOrEmpty,
  formatSalaryKrPerMonth,
  marketBalanceLabel,
  formatPeriodLine,
  type MarketOverviewPayload,
  type IndustryTrendItem,
  type RegionalSignalItem,
  type CareerDirectionItem,
  type EmployerNeedItem,
  type CompetenceAreaItem,
  type SuggestedExploration,
  type DataSource,
  resolveDataSourceHeading,
  resolveDataSourceBody,
  shouldRenderDataSource,
  mergeDataSources,
  FALLBACK_DATA_SOURCES,
  type IndustrySkillSignalsPayload,
  type IndustrySkillSignalItem,
  type MarketCapacityItem,
  type MarketCapacityRpcPayload,
  
  type MarketCapacityOverviewPayload,
  type MarketBalanceTone,
} from "@/lib/supabase";
import {
  resolveSalaryIndustry,
  SALARY_PROFILE_SOURCES,
  type SalaryIndustrySource,
} from "@/lib/salaryProfile";
import { SalaryProfileSection } from "@/components/career/SalaryProfileSection";
import { useQuery } from "@tanstack/react-query";


// ============================================================
// Public click model
// ============================================================

export type DetailPayload =
  | { kind: "skill"; data: CompetenceAreaItem }
  | { kind: "employer_need"; data: EmployerNeedItem }
  | { kind: "data_source"; data: DataSource };

export type ExplorationAction =
  | "focus_region"
  | "focus_industry"
  | "focus_search"
  | "scroll_competence"
  | "scroll_careers"
  | "scroll_data";

export type MarketOverviewHandlers = {
  onPickIndustry: (slug: string) => void;
  onPickRegion: (code: string) => void;
  onClearIndustry: () => void;
  onClearRegion: () => void;
  onOpenCareerDirection: (params: { occupation_uri: string; title: string }) => void;
  onOpenDetail: (detail: DetailPayload) => void;
  onFocusRegion: () => void;
  onFocusIndustry: () => void;
  onFocusSearch: () => void;
  onPickDemandSignal: (n: EmployerNeedItem) => void;
  onClearDemandSignal: () => void;
  onSearchOccupation?: (title: string) => void;
};

// ============================================================
// Helpers
// ============================================================

function pct(n: number | string | null | undefined, digits = 1): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return "–";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} %`;
}

function num(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return "–";
  return new Intl.NumberFormat("nb-NO").format(Math.round(v));
}

function signalLabel(level?: string | null, value?: number | null): string {
  const lvl = (level ?? "").toLowerCase();
  if (lvl === "high" || lvl === "strong") return "Sterkt signal";
  if (lvl === "medium" || lvl === "moderate") return "Moderat signal";
  if (lvl === "low" || lvl === "weak") return "Svakt signal";
  if (value != null) {
    if (value >= 70) return "Sterkt signal";
    if (value >= 40) return "Moderat signal";
    if (value > 0) return "Svakt signal";
  }
  return "Ikke nok data";
}

function chipClass(label: string): string {
  if (label === "Sterkt signal") return "km-chip km-chip-success";
  if (label === "Moderat signal") return "km-chip km-chip-warning";
  if (label === "Svakt signal") return "km-chip km-chip-danger";
  return "km-chip";
}

function humanizeSignalType(t?: string | null): string {
  const s = (t ?? "").toLowerCase();
  if (s.includes("unmet")) return "Udekket kompetansebehov";
  if (s.includes("education")) return "Utdanningsnivå";
  if (s.includes("competence_field") || s.includes("fagomr")) return "Etterspurt fagområde";
  if (s.includes("upskill") || s.includes("kompetansehev")) return "Kompetanseheving";
  return "Arbeidsgivers signal";
}

const SECTION_CARD =
  "border border-rule rounded-3 bg-white p-5 md:p-6";

const ROW_BUTTON =
  "w-full text-left rounded-2 px-3 py-2.5 -mx-1 transition-colors " +
  "hover:bg-[var(--km-paper-warm)] focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-[var(--km-blue)] cursor-pointer";

const CARD_BUTTON =
  "w-full text-left border border-rule rounded-2 bg-white p-3 md:p-4 " +
  "transition-colors hover:bg-[var(--km-paper-warm)] hover:border-[var(--km-ink-soft)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--km-blue)] cursor-pointer";

const CHIP_BUTTON =
  "inline-flex items-center rounded-2 border border-rule bg-white px-2.5 py-1 text-xs " +
  "transition-colors hover:bg-[var(--km-paper-warm)] hover:border-[var(--km-ink-soft)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--km-blue)] cursor-pointer";

// ============================================================
// Loading / error states
// ============================================================

export function MarketOverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className={cn(SECTION_CARD, "animate-pulse space-y-3")}>
        <div className="h-5 w-1/3 bg-[var(--km-paper-warm)] rounded" />
        <div className="h-4 w-2/3 bg-[var(--km-paper-warm)] rounded" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-rule rounded-3 bg-white p-4 h-28 animate-pulse"
          />
        ))}
      </div>
      <div className={cn(SECTION_CARD, "animate-pulse space-y-2")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-[var(--km-paper-warm)] rounded" />
        ))}
      </div>
    </div>
  );
}

export function MarketOverviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className={cn(
        SECTION_CARD,
        "flex flex-col sm:flex-row sm:items-center gap-4",
      )}
    >
      <div className="flex items-start gap-3 flex-1">
        <AlertCircle className="h-5 w-5 text-[var(--km-danger)] mt-0.5 shrink-0" />
        <div>
          <div className="font-medium text-[var(--km-ink)]">
            Vi klarte ikke å hente markedsbildet akkurat nå.
          </div>
          <div className="text-sm text-[var(--km-ink-soft)]">
            Prøv på nytt – det går oftest etter et par sekunder.
          </div>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Prøv igjen
      </Button>
    </div>
  );
}

export function MarketOverviewRefreshing() {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Oppdaterer markedsbildet …
    </div>
  );
}

// ============================================================
// MarketOverview
// ============================================================

function SectionHead({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h3 className="text-base md:text-lg font-semibold flex items-center gap-2 text-[var(--km-ink)]">
        <span className="text-[var(--km-ink-soft)]">{icon}</span>
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-[var(--km-ink-soft)] mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function TrendDelta({ value }: { value: number | string | null | undefined }) {
  const v = typeof value === "string" ? Number(value) : value;
  if (v == null || Number.isNaN(v)) return null;
  const cls =
    v > 0
      ? "text-[var(--km-success)]"
      : v < 0
        ? "text-[var(--km-danger)]"
        : "text-[var(--km-ink-soft)]";
  const Icon = v > 0 ? TrendingUp : v < 0 ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      Endring fra forrige år: {pct(v)}
    </span>
  );
}

// ---- Segmenter og endringstall ----

function toNum(n: number | string | null | undefined): number | null {
  if (n == null) return null;
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : null;
}

function signedNum(v: number, digits = 0): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const formatted =
    digits > 0
      ? new Intl.NumberFormat("nb-NO", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(abs)
      : new Intl.NumberFormat("nb-NO").format(Math.round(abs));
  return `${sign}${formatted}`;
}

function signedPct(v: number, digits = 1): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  return `${sign}${abs.toFixed(digits).replace(".", ",")} %`;
}

function changeToneClass(v: number): string {
  if (v > 0) return "text-[var(--km-success)]";
  if (v < 0) return "text-[var(--km-danger)]";
  return "text-[var(--km-ink-soft)]";
}

function EmploymentChangeStat({
  percent,
  absolute,
  unit = "sysselsatte",
}: {
  percent: number | string | null | undefined;
  absolute: number | string | null | undefined;
  unit?: "sysselsatte" | "tusen sysselsatte";
}) {
  const p = toNum(percent);
  const a = toNum(absolute);
  if (p == null && a == null) return null;
  const tone = p != null ? p : a != null ? a : 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums whitespace-nowrap",
        changeToneClass(tone),
      )}
    >
      {p != null ? signedPct(p) : "–"}
      {a != null && (
        <>
          <span className="text-[var(--km-ink-soft)]">·</span>
          {signedNum(a)} {unit}
        </>
      )}
    </span>
  );
}

function SignalChangeStat({
  pp,
  relativePercent,
}: {
  pp: number | string | null | undefined;
  relativePercent?: number | string | null | undefined;
}) {
  const p = toNum(pp);
  const r = toNum(relativePercent);
  if (p == null && r == null) return null;
  const tone = p != null ? p : r != null ? r : 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums whitespace-nowrap",
        changeToneClass(tone),
      )}
    >
      {p != null ? `${signedNum(p, 1)} prosentpoeng` : "–"}
      {r != null && (
        <span className="text-[var(--km-ink-soft)]">({signedPct(r, 0)} relativt)</span>
      )}
    </span>
  );
}

type SegmentOption<V extends string> = { value: V; label: string };

function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: V;
  options: SegmentOption<V>[];
  onChange: (v: V) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-2 border border-rule bg-[var(--km-paper-warm)] p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-[var(--km-blue)]",
              active
                ? "bg-white text-[var(--km-blue)] border border-[var(--km-blue)]"
                : "text-[var(--km-ink-soft)] hover:text-[var(--km-ink)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptySegmentState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2 border border-rule bg-[var(--km-paper-warm)] px-3 py-3 text-xs text-[var(--km-ink-soft)]">
      {text}
    </div>
  );
}

type LeaderSegment = "spotlight" | "growth" | "decline";

const LEADER_OPTIONS: SegmentOption<LeaderSegment>[] = [
  { value: "spotlight", label: "Sterkest signal" },
  { value: "growth", label: "Størst vekst" },
  { value: "decline", label: "Størst nedgang" },
];

type SortMode = "signal" | "amount" | "percent";

const SPOTLIGHT_SORT_OPTIONS: SegmentOption<SortMode>[] = [
  { value: "signal", label: "Signal" },
  { value: "amount", label: "Antall" },
];

const CHANGE_SORT_OPTIONS: SegmentOption<SortMode>[] = [
  { value: "percent", label: "Prosent" },
  { value: "amount", label: "Antall" },
];

function sortOptionsFor(segment: LeaderSegment): SegmentOption<SortMode>[] {
  return segment === "spotlight" ? SPOTLIGHT_SORT_OPTIONS : CHANGE_SORT_OPTIONS;
}

function defaultSortFor(segment: LeaderSegment): SortMode {
  return segment === "spotlight" ? "signal" : "percent";
}

function getAmount(
  it: IndustryTrendItem | RegionalSignalItem | CareerDirectionItem,
): number | null {
  const anyIt = it as Record<string, unknown>;
  return (
    toNum(anyIt.employed_latest as number | string | null | undefined) ??
    toNum(anyIt.employed_latest_thousands as number | string | null | undefined) ??
    toNum(
      (it as CareerDirectionItem).regional_signal
        ? ((it as CareerDirectionItem).regional_signal as unknown as { employed_latest?: number | string | null })
            .employed_latest
        : null,
    )
  );
}

function getPercentChange(
  it: IndustryTrendItem | RegionalSignalItem | CareerDirectionItem,
): number | null {
  const anyIt = it as Record<string, unknown>;
  return (
    toNum(anyIt.context_percent_change as number | string | null | undefined) ??
    toNum(anyIt.percent_change as number | string | null | undefined)
  );
}

function getAbsoluteChange(
  it: IndustryTrendItem | RegionalSignalItem | CareerDirectionItem,
): number | null {
  const anyIt = it as Record<string, unknown>;
  return (
    toNum(anyIt.context_absolute_change as number | string | null | undefined) ??
    toNum(anyIt.absolute_change as number | string | null | undefined) ??
    toNum(anyIt.absolute_change_thousands as number | string | null | undefined)
  );
}

function getSpotlightSignal(
  it: IndustryTrendItem | RegionalSignalItem | CareerDirectionItem,
): number | null {
  const anyIt = it as Record<string, unknown>;
  return (
    toNum(anyIt.region_signal_score as number | string | null | undefined) ??
    toNum(anyIt.direction_score as number | string | null | undefined) ??
    toNum(anyIt.market_signal_score as number | string | null | undefined)
  );
}

function sortLeaders<
  T extends IndustryTrendItem | RegionalSignalItem | CareerDirectionItem,
>(items: T[], segment: LeaderSegment, mode: SortMode): T[] {
  const arr = [...items];
  if (segment === "spotlight") {
    if (mode === "amount") {
      arr.sort((a, b) => (getAmount(b) ?? -Infinity) - (getAmount(a) ?? -Infinity));
    } else {
      // signal: sort by available signal score; fall back to backend order
      const hasAny = arr.some((x) => getSpotlightSignal(x) != null);
      if (hasAny) {
        arr.sort(
          (a, b) => (getSpotlightSignal(b) ?? -Infinity) - (getSpotlightSignal(a) ?? -Infinity),
        );
      }
    }
    return arr;
  }
  const pick = mode === "amount" ? getAbsoluteChange : getPercentChange;
  arr.sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (segment === "growth") {
      return (bv ?? -Infinity) - (av ?? -Infinity);
    }
    return (av ?? Infinity) - (bv ?? Infinity);
  });
  return arr;
}

function SortToggle({
  segment,
  value,
  onChange,
  ariaLabel,
}: {
  segment: LeaderSegment;
  value: SortMode;
  onChange: (v: SortMode) => void;
  ariaLabel: string;
}) {
  const options = sortOptionsFor(segment);
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
      <span>Sorter etter:</span>
      <SegmentedControl
        ariaLabel={ariaLabel}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

function emptyForLeader(
  kind: "industry" | "region" | "career",
  segment: LeaderSegment,
): string {
  if (kind === "region") {
    if (segment === "growth")
      return "Vi finner ingen tydelig positiv endring i underområdene for dette utvalget.";
    if (segment === "decline")
      return "Vi finner ingen tydelig negativ endring i underområdene for dette utvalget.";
    return "Vi finner ingen tydelige underområder i valgt område.";
  }
  if (kind === "industry") {
    return "Valgt bransje vises som kontekst, ikke som eget funn.";
  }
  if (segment === "growth")
    return "Vi finner ingen tydelig positiv endring i karriereretningene i dette utvalget.";
  if (segment === "decline")
    return "Vi finner ingen tydelig negativ endring i karriereretningene i dette utvalget.";
  return "Vi finner ingen andre karriereretninger i dette utvalget.";
}


export function MarketOverview({
  payload,
  filters,
  handlers,
  isRefreshing,
  selectedDemandSignal,
  skillSignals,
  skillSignalsLoading,
}: {
  payload: MarketOverviewPayload;
  filters: { regionCode: string | null; industrySlug: string | null };
  handlers: MarketOverviewHandlers;
  isRefreshing?: boolean;
  selectedDemandSignal?: EmployerNeedItem | null;
  skillSignals?: IndustrySkillSignalsPayload | null;
  skillSignalsLoading?: boolean;
}) {
  const summary = payload.summary ?? {};
  const industryItems =
    payload.industry_trends?.items ?? payload.industry_trends?.growth_leaders ?? [];
  const careerItems = payload.career_directions?.items ?? [];
  const employerNeeds = payload.employer_needs ?? {};
  const competenceSamples = payload.competence_areas?.sample_skills ?? [];
  const explorations = payload.suggested_explorations ?? [];
  const overviewSources = payload.data_sources ?? [];
  const notes = payload.confidence_notes ?? [];
  const [capacitySources, setCapacitySources] = useState<DataSource[]>([]);

  const regionLabel = summary.filter_region_label
    ? cleanRegionLabel(summary.filter_region_label)
    : null;
  const industryName = summary.filter_industry_name ?? null;

  const salaryResolved = useMemo(
    () =>
      resolveSalaryIndustry({
        filterSlug: filters.industrySlug,
        filterName: industryName,
        payload,
        knownIndustries: payload.industry_trends?.items ?? null,
      }),
    [payload, filters, industryName],
  );
  const salarySources =
    salaryResolved.source !== "none" ? SALARY_PROFILE_SOURCES : [];

  const mergedSources = useMemo(() => {
    const merged = mergeDataSources(overviewSources, capacitySources, salarySources);
    return merged.length > 0 ? merged : FALLBACK_DATA_SOURCES;
  }, [overviewSources, capacitySources, salarySources]);


  // Deduped pool used both for cards and focus block, so they stay aligned.
  const needPool = useMemo(
    () =>
      dedupeNeeds(
        [
          ...(employerNeeds.competence_fields ?? []),
          ...(employerNeeds.education_levels ?? []),
          ...(employerNeeds.signals ?? []),
        ],
        filters,
      ),
    [employerNeeds, filters],
  );

  return (
    <div className="space-y-6">
      {/* 1. Summary */}
      <section className={SECTION_CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-semibold text-[var(--km-ink)]">
              {summary.title ?? "Dette peker seg ut akkurat nå"}
            </h2>
            {summary.description && (
              <p className="text-sm text-[var(--km-ink-soft)] mt-1 max-w-3xl">
                {summary.description}
              </p>
            )}
          </div>
          {isRefreshing && <MarketOverviewRefreshing />}
        </div>

        {(filters.regionCode || filters.industrySlug) && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-xs text-[var(--km-ink-soft)]">Filtrert på:</span>
            {filters.industrySlug && (
              <FilterChip
                label={industryName ?? "Valgt bransje"}
                onClear={handlers.onClearIndustry}
              />
            )}
            {filters.regionCode && (
              <FilterChip
                label={regionLabel ?? "Valgt område"}
                onClear={handlers.onClearRegion}
              />
            )}
          </div>
        )}
      </section>

      {/* 1b. Fokusblokk for valgt NHO-behovssignal */}
      {selectedDemandSignal && (
        <DemandSignalFocus
          signal={selectedDemandSignal}
          needPool={needPool}
          careerItems={careerItems}
          industryItems={industryItems}
          competenceSamples={competenceSamples}
          filters={filters}
          handlers={handlers}
        />
      )}

      {/* 2. Behovskompass NHO */}
      <EmployerNeedsSection
        employerNeeds={employerNeeds}
        hasIndustryFilter={!!filters.industrySlug}
        industryName={industryName}
        selectedDemandSignal={selectedDemandSignal ?? null}
        onPickDemandSignal={handlers.onPickDemandSignal}
        onOpenDetail={handlers.onOpenDetail}
      />

      {/* 2b. NAV + SSB markedskapasitet */}
      <MarketCapacityOverviewSection
        onSearchOccupation={handlers.onSearchOccupation}
        onSourcesLoaded={setCapacitySources}
        regionCode={filters.regionCode}
        industrySlug={filters.industrySlug}
      />

      {/* 2c. SSB lønnsprofil per bransje */}
      <SalaryProfileSection
        industrySlug={salaryResolved.slug}
        industryName={salaryResolved.name}
        source={salaryResolved.source}
        variant="standalone"
      />




      {/* 3. Bransjer */}
      <IndustryTrendsSection
        data={payload.industry_trends ?? {}}
        filterIndustrySlug={filters.industrySlug}
        filterIndustryName={industryName}
        onPickIndustry={handlers.onPickIndustry}
      />

      {/* 4. Områder */}
      <RegionalSignalsSection
        data={payload.regional_signals ?? {}}
        hasFilter={!!filters.regionCode}
        filterRegionCode={filters.regionCode}
        filterRegionLabel={regionLabel}
        onPickRegion={handlers.onPickRegion}
      />

      {/* 5. Karriereretninger */}
      <CareerDirectionsSection
        data={payload.career_directions ?? {}}
        onOpenCareerDirection={handlers.onOpenCareerDirection}
      />

      {/* 6. Kompetanseområder */}
      <CompetenceAreasSection
        employerNeeds={employerNeeds}
        sampleSkills={competenceSamples}
        onPickDemandSignal={handlers.onPickDemandSignal}
        onOpenDetail={handlers.onOpenDetail}
      />

      {/* 6b. Kompetansekrav i valgt utvalg (ESCO/STYRK via RPC) */}
      <IndustrySkillSignalsSection
        data={skillSignals ?? null}
        isLoading={!!skillSignalsLoading}
        onOpenCareerDirection={handlers.onOpenCareerDirection}
      />




      {/* 7. Forslag */}
      <SuggestedExplorationsSection
        items={explorations}
        handlers={handlers}
      />

      {/* 8. Datagrunnlag */}
      <DataSourcesSection
        sources={mergedSources}
        notes={notes}
        onOpenDetail={handlers.onOpenDetail}
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-rule bg-[var(--km-paper-warm)] px-2.5 py-1 text-xs text-[var(--km-ink)]">
      {label}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        aria-label={`Fjern filter: ${label}`}
        className="ml-1 rounded-full p-0.5 hover:bg-white cursor-pointer"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ===== Sub-sections =====

type BehovsSegment = "strongest" | "weakest" | "increase" | "decrease";

function filterStrongNeeds(items: EmployerNeedItem[]): EmployerNeedItem[] {
  return items
    .filter((n) => !isUnmet(n))
    .filter((n) => norm(n.label) !== "udekket kompetansebehov")
    .filter((n) => (n.level ?? "").toLowerCase() !== "low")
    .filter((n) => {
      const v = Number(n.value ?? n.high_intensity_value ?? 0);
      return v >= 40;
    })
    .sort((a, b) => {
      const av = Number(a.value ?? a.high_intensity_value ?? 0);
      const bv = Number(b.value ?? b.high_intensity_value ?? 0);
      return bv - av;
    });
}

function behovsEmpty(
  segment: BehovsSegment,
  hasIndustryFilter: boolean,
): string {
  if (segment === "weakest")
    return "Vi finner ikke nok sammenlignbare signaler i dette utvalget.";
  if (segment === "increase")
    return "Vi har ikke historikk nok til å vise økning i dette utvalget.";
  if (segment === "decrease")
    return "Vi har ikke historikk nok til å vise nedgang i dette utvalget.";
  if (hasIndustryFilter)
    return "Vi finner ingen sterke bransjespesifikke NHO-signaler i dette utvalget.";
  return "Vi finner ingen tydelige NHO-signaler i dette utvalget.";
}

function EmployerNeedsSection({
  employerNeeds,
  hasIndustryFilter,
  industryName,
  selectedDemandSignal,
  onPickDemandSignal,
  onOpenDetail,
}: {
  employerNeeds: NonNullable<MarketOverviewPayload["employer_needs"]>;
  hasIndustryFilter: boolean;
  industryName: string | null;
  selectedDemandSignal: EmployerNeedItem | null;
  onPickDemandSignal: (n: EmployerNeedItem) => void;
  onOpenDetail: (d: DetailPayload) => void;
}) {
  const trendAvailable = employerNeeds.trend_available === true;
  const hasWeakest = (employerNeeds.weakest_signals?.length ?? 0) > 0;

  const options = useMemo(() => {
    const opts: SegmentOption<BehovsSegment>[] = [
      { value: "strongest", label: "Sterkest signal" },
    ];
    if (hasWeakest) opts.push({ value: "weakest", label: "Lavest signal" });
    if (trendAvailable) {
      opts.push({ value: "increase", label: "Størst økning" });
      opts.push({ value: "decrease", label: "Størst nedgang" });
    }
    return opts;
  }, [trendAvailable, hasWeakest]);

  const [segment, setSegment] = useState<BehovsSegment>("strongest");
  const effectiveSegment: BehovsSegment = options.some((o) => o.value === segment)
    ? segment
    : "strongest";

  const rawStrongest = employerNeeds.strongest_signals ?? [];
  const strongest = useMemo(() => filterStrongNeeds(rawStrongest), [rawStrongest]);

  const items: EmployerNeedItem[] =
    effectiveSegment === "weakest"
      ? (employerNeeds.weakest_signals ?? []).filter((n) => !isUnmet(n))
      : effectiveSegment === "increase"
        ? (employerNeeds.largest_increases ?? []).filter((n) => !isUnmet(n))
        : effectiveSegment === "decrease"
          ? (employerNeeds.largest_decreases ?? []).filter((n) => !isUnmet(n))
          : strongest;

  // If there are no signals at all in any segment, hide the section entirely.
  const hasAnyData =
    strongest.length > 0 ||
    (employerNeeds.weakest_signals?.length ?? 0) > 0 ||
    (employerNeeds.largest_increases?.length ?? 0) > 0 ||
    (employerNeeds.largest_decreases?.length ?? 0) > 0;
  if (!hasAnyData) return null;

  const subtitle =
    effectiveSegment === "weakest"
      ? "Fagområder og utdanningsnivåer med lavest rapportert behov i valgt utvalg."
      : "Fagområder og utdanningsnivåer arbeidsgivere peker mest på i valgt utvalg – signaler, ikke fasit.";

  const final = items.slice(0, 6);
  const showCalmMessage =
    effectiveSegment === "strongest" && final.length === 0 && hasIndustryFilter;

  return (
    <section className={SECTION_CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<Target className="h-4 w-4" />}
          title="Behovskompass fra NHO"
          subtitle={subtitle}
        />
        {options.length > 1 && (
          <SegmentedControl
            ariaLabel="Velg visning for Behovskompass"
            value={effectiveSegment}
            options={options}
            onChange={setSegment}
          />
        )}
      </div>

      {final.length === 0 ? (
        <>
          <EmptySegmentState text={behovsEmpty(effectiveSegment, hasIndustryFilter)} />
          {showCalmMessage && (employerNeeds.strongest_signals?.length ?? 0) > 0 && (
            <p className="text-[11px] text-[var(--km-ink-soft)] mt-2">
              Nasjonale signaler kan fortsatt være relevante som sammenligningsgrunnlag.
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-4">
          {final.map((n, i) => {
            const label = signalLabel(n.level, n.value ?? n.high_intensity_value ?? null);
            const isActive = matchesNeedSignal(selectedDemandSignal, n);
            const displayLabel = n.label ?? humanizeSignalType(n.type);
            return (
              <article
                key={`${n.type ?? "n"}-${i}`}
                className={cn(
                  "relative border border-rule rounded-2 bg-white transition-colors",
                  "hover:bg-[var(--km-paper-warm)] hover:border-[var(--km-ink-soft)]",
                  isActive &&
                    "ring-2 ring-[var(--km-blue)] ring-offset-1 ring-offset-white border-[var(--km-blue)] bg-[var(--km-paper-warm)]",
                )}
              >
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`Velg behovssignal: ${displayLabel}`}
                  onClick={() => onPickDemandSignal(n)}
                  className={cn(
                    "block w-full text-left p-3 md:p-4 pr-12 rounded-2 cursor-pointer",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    "focus-visible:outline-[var(--km-blue)]",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold leading-tight text-[var(--km-ink)]">
                      {displayLabel}
                    </h4>
                    <span className={cn("text-[10px] shrink-0", chipClass(label))}>
                      {label}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
                    {humanizeSignalType(n.type)}
                    {n.scope ? ` · ${n.scope}` : ""}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`Vis detaljer om ${displayLabel}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetail({ kind: "employer_need", data: n });
                  }}
                  className={cn(
                    "absolute top-2 right-2 inline-flex h-9 w-9 items-center justify-center",
                    "rounded-2 text-[var(--km-ink-soft)] hover:text-[var(--km-ink)]",
                    "hover:bg-white cursor-pointer",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    "focus-visible:outline-[var(--km-blue)]",
                  )}
                >
                  <Info className="h-4 w-4" />
                </button>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-[var(--km-ink-soft)] mt-3">
        Kilde: NHO Kompetansebarometeret{industryName ? ` · valgt bransje: ${industryName}` : ""}.
      </p>
    </section>
  );
}

// ============================================================
// DemandSignalFocus
// ============================================================

function DemandSignalFocus({
  signal,
  needPool,
  careerItems,
  industryItems,
  competenceSamples,
  filters,
  handlers,
}: {
  signal: EmployerNeedItem;
  needPool: EmployerNeedItem[];
  careerItems: CareerDirectionItem[];
  industryItems: IndustryTrendItem[];
  competenceSamples: CompetenceAreaItem[];
  filters: { regionCode: string | null; industrySlug: string | null };
  handlers: MarketOverviewHandlers;
}) {
  const [careersExpanded, setCareersExpanded] = useState(false);
  const kind = signalKind(signal);
  const label = signal.label ?? humanizeSignalType(signal.type);

  // Is this signal actually present in the current payload?
  const present = useMemo(
    () => needPool.some((n) => matchesNeedSignal(n, signal)) ,
    [needPool, signal],
  );

  const subtitle =
    kind === "competence_field"
      ? "Dette er et behovssignal fra NHO Kompetansebarometeret. Det viser hvilke fagområder arbeidsgivere peker på i valgt utvalg."
      : kind === "education_level"
        ? "Dette er et utdanningssignal fra NHO Kompetansebarometeret. Det sier noe om kvalifikasjonsnivå arbeidsgivere peker på, ikke en konkret stillingskompetanse."
        : "Dette er et behovssignal fra NHO Kompetansebarometeret. Bruk det som retning, ikke fasit.";

  const signalLvl = signalLabel(
    signal.level,
    signal.value ?? signal.high_intensity_value ?? null,
  );

  // Sort career directions with a single computed score (no mutation).
  const sortedCareers = useMemo(() => {
    const items = [...careerItems].map((it) => {
      const industryBoost =
        signal.industry_slug &&
        it.industries?.some((x) => x.slug === signal.industry_slug)
          ? 10
          : 0;
      const regionBoost =
        filters.regionCode &&
        matchesRegion(filters.regionCode, it.regional_signal?.region_code ?? null)
          ? 8
          : 0;
      return {
        it,
        computed: Number(it.direction_score ?? 0) + industryBoost + regionBoost,
      };
    });
    items.sort((a, b) => b.computed - a.computed);
    return items.map((x) => x.it);
  }, [careerItems, signal.industry_slug, filters.regionCode]);

  const CAREERS_VISIBLE = 8;
  const careersShown = careersExpanded
    ? sortedCareers
    : sortedCareers.slice(0, CAREERS_VISIBLE);

  // Related signals of the same type (excluding self), from the deduped pool.
  const relatedSignals = useMemo(
    () =>
      needPool
        .filter(
          (n) =>
            (n.type ?? "") === (signal.type ?? "") &&
            !matchesNeedSignal(n, signal),
        )
        .slice(0, 8),
    [needPool, signal],
  );

  const showCompetenceArea =
    kind === "competence_field" || kind === "education_level";

  const samplesNote =
    kind === "education_level"
      ? "Dette er eksempler fra karriereretningene i utvalget, ikke direkte krav fra utdanningssignalet."
      : "Eksempelkompetanser fra karriereretninger i utvalget. Ikke direkte avledet fra behovssignalet.";

  return (
    <section
      id="behov-fokus"
      className={cn(SECTION_CARD, "space-y-5 scroll-mt-24")}
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-pill border border-[var(--km-blue)] bg-white px-2.5 py-1 text-xs text-[var(--km-ink)]">
            Behov: {label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onClearDemandSignal();
              }}
              aria-label="Fjern behovssignal-fokus"
              className="ml-1 rounded-full p-0.5 hover:bg-[var(--km-paper-warm)] cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
        <h3 className="text-lg md:text-xl font-semibold text-[var(--km-ink)]">
          Utforsker: {label}
        </h3>
        <p className="text-sm text-[var(--km-ink-soft)] max-w-3xl">{subtitle}</p>
        {!present && (
          <div className="flex items-start gap-2 rounded-2 border border-rule bg-[var(--km-paper-warm)] px-3 py-2 text-xs text-[var(--km-ink-soft)]">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Dette signalet finnes ikke tydelig i valgt utvalg.</span>
          </div>
        )}
      </div>

      {/* Signalstyrke */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--km-ink-soft)]">
        <span className={chipClass(signalLvl)}>{signalLvl}</span>
        {signal.year && <span>Årgang: {signal.year}</span>}
        {signal.scope && <span>Omfang: {signal.scope}</span>}
        <span>Kilde: NHO Kompetansebarometeret</span>
      </div>

      {/* Karriereretninger */}
      <div id="demand-careers" className="space-y-3 scroll-mt-24">
        <h4 className="text-sm font-semibold text-[var(--km-ink)]">
          Relevante karriereretninger
        </h4>
        {careersShown.length === 0 ? (
          <p className="text-xs text-[var(--km-ink-soft)]">
            Vi fant ikke karriereretninger som peker mot dette signalet i valgt utvalg.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {careersShown.map((it) => {
              const lvl = signalLabel(
                it.market_signal_level,
                it.market_signal_score ?? null,
              );
              const primaryIndustry = it.industries?.[0]?.name ?? null;
              const region = it.regional_signal?.region_label
                ? cleanRegionLabel(it.regional_signal.region_label)
                : null;
              return (
                <button
                  key={it.occupation_uri}
                  type="button"
                  aria-label={`Åpne Karrierekompass for ${it.title}`}
                  onClick={() =>
                    handlers.onOpenCareerDirection({
                      occupation_uri: it.occupation_uri,
                      title: it.title,
                    })
                  }
                  className={CARD_BUTTON}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="text-sm font-semibold leading-tight text-[var(--km-ink)] capitalize">
                      {it.title}
                    </h5>
                    <span className={cn("text-[10px] shrink-0", chipClass(lvl))}>
                      {lvl}
                    </span>
                  </div>
                  {(primaryIndustry || region) && (
                    <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
                      {primaryIndustry}
                      {primaryIndustry && region ? " · " : ""}
                      {region}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {sortedCareers.length > CAREERS_VISIBLE && (
          <button
            type="button"
            aria-label={
              careersExpanded
                ? "Vis færre karriereretninger"
                : "Vis flere karriereretninger"
            }
            onClick={(e) => {
              e.stopPropagation();
              setCareersExpanded((v) => !v);
            }}
            className="text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
          >
            {careersExpanded
              ? "Vis færre"
              : `Vis flere (${sortedCareers.length - CAREERS_VISIBLE})`}
          </button>
        )}
      </div>

      {/* Relevante bransjer */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-[var(--km-ink)]">
          Relevante bransjer
        </h4>
        {signal.industry_slug && signal.industry_name_no ? (
          <button
            type="button"
            aria-label={`Filtrer på bransje: ${signal.industry_name_no}`}
            onClick={() => handlers.onPickIndustry(signal.industry_slug!)}
            className={cn(ROW_BUTTON, "flex items-center justify-between gap-3")}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                Filtrér på {signal.industry_name_no}
              </div>
              <div className="text-[11px] text-[var(--km-ink-soft)]">
                Signalet er knyttet til denne bransjen.
              </div>
            </div>
          </button>
        ) : industryItems.filter((it) => !isSelectedIndustry(it, filters.industrySlug, null)).length > 0 ? (
          <>
            <p className="text-xs text-[var(--km-ink-soft)]">
              Bransjer som kan være relevante å undersøke videre.
            </p>
            <ul className="divide-y divide-[var(--km-rule-soft,var(--km-rule))]">
              {industryItems
                .filter((it) => !isSelectedIndustry(it, filters.industrySlug, null))
                .slice(0, 6)
                .map((it) => (
                <li key={it.slug}>
                  <button
                    type="button"
                    aria-label={`Filtrer på bransje: ${it.name}`}
                    onClick={() => handlers.onPickIndustry(it.slug)}
                    className={cn(
                      ROW_BUTTON,
                      "flex items-center justify-between gap-3",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                        {it.name}
                      </div>
                      {it.latest_year && (
                        <div className="text-[11px] text-[var(--km-ink-soft)]">
                          {String(it.latest_year)}
                        </div>
                      )}
                    </div>
                    <TrendDelta value={it.percent_change} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-[var(--km-ink-soft)]">
            Ingen bransjer å vise her.
          </p>
        )}
      </div>

      {/* Relevante kompetanseområder */}
      {showCompetenceArea && (relatedSignals.length > 0 || competenceSamples.length > 0) && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--km-ink)]">
            Relaterte behovssignaler og eksempelkompetanser
          </h4>
          {relatedSignals.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--km-ink-soft)]">
                Andre {kind === "education_level" ? "utdanningsnivåer" : "fagområder"} arbeidsgivere peker på.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {relatedSignals.map((n, i) => (
                  <li key={`rel-${i}`}>
                    <button
                      type="button"
                      aria-label={`Velg behovssignal: ${n.label}`}
                      onClick={() => handlers.onPickDemandSignal(n)}
                      className={CHIP_BUTTON}
                    >
                      {n.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {competenceSamples.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--km-ink-soft)]">{samplesNote}</p>
              <ul className="flex flex-wrap gap-1.5">
                {competenceSamples.slice(0, 8).map((c) => (
                  <li key={c.uri}>
                    <button
                      type="button"
                      aria-label={`Vis detaljer for kompetanse: ${c.label}`}
                      onClick={() => handlers.onOpenDetail({ kind: "skill", data: c })}
                      className={CHIP_BUTTON}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* CTA-er */}
      <div className="grid gap-2 sm:grid-cols-3 pt-2 border-t border-rule">
        <button
          type="button"
          aria-label="Se relevante karriereretninger"
          onClick={() =>
            document
              .getElementById("demand-careers")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={CARD_BUTTON}
        >
          <span className="text-sm font-medium text-[var(--km-ink)]">
            Se relevante karriereretninger
          </span>
        </button>
        <button
          type="button"
          aria-label="Kombiner med bransje"
          onClick={handlers.onFocusIndustry}
          className={CARD_BUTTON}
        >
          <span className="text-sm font-medium text-[var(--km-ink)]">
            Kombiner med bransje
          </span>
        </button>
        <button
          type="button"
          aria-label="Kombiner med område"
          onClick={handlers.onFocusRegion}
          className={CARD_BUTTON}
        >
          <span className="text-sm font-medium text-[var(--km-ink)]">
            Kombiner med område
          </span>
        </button>
      </div>
    </section>
  );
}



function IndustryTrendsSection({
  data,
  filterIndustrySlug,
  filterIndustryName,
  onPickIndustry,
}: {
  data: NonNullable<MarketOverviewPayload["industry_trends"]>;
  filterIndustrySlug?: string | null;
  filterIndustryName?: string | null;
  onPickIndustry: (slug: string) => void;
}) {
  const [segment, setSegment] = useState<LeaderSegment>("spotlight");
  const [sortMode, setSortMode] = useState<SortMode>(defaultSortFor("spotlight"));
  const [expanded, setExpanded] = useState(false);

  const rawItems =
    segment === "growth"
      ? (data.growth_leaders ?? [])
      : segment === "decline"
        ? (data.decline_leaders ?? [])
        : (data.items ?? []);

  // Pull the selected industry aside as context (don't repeat as a "finding").
  const selectedItem = useMemo(
    () =>
      filterIndustrySlug || filterIndustryName
        ? rawItems.find((it) =>
            isSelectedIndustry(it, filterIndustrySlug, filterIndustryName),
          ) ?? null
        : null,
    [rawItems, filterIndustrySlug, filterIndustryName],
  );

  const filteredItems = useMemo(
    () =>
      filterIndustrySlug || filterIndustryName
        ? rawItems.filter(
            (it) => !isSelectedIndustry(it, filterIndustrySlug, filterIndustryName),
          )
        : rawItems,
    [rawItems, filterIndustrySlug, filterIndustryName],
  );

  const items = useMemo(
    () => sortLeaders(filteredItems, segment, sortMode),
    [filteredItems, segment, sortMode],
  );

  const VISIBLE = 6;
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <section className={SECTION_CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<Building2 className="h-4 w-4" />}
          title="Bransjer som peker seg ut"
          subtitle="Trykk en bransje for å se filtrert markedsbilde."
        />
        <div className="flex flex-col items-end gap-2">
          <SegmentedControl
            ariaLabel="Velg utvalg for bransjer"
            value={segment}
            options={LEADER_OPTIONS}
            onChange={(v) => {
              setSegment(v);
              setSortMode(defaultSortFor(v));
              setExpanded(false);
            }}
          />
          <SortToggle
            segment={segment}
            value={sortMode}
            onChange={setSortMode}
            ariaLabel="Sorteringsgrunnlag for bransjer"
          />
        </div>
      </div>

      {selectedItem && (
        <div className="mt-4 rounded-2 border border-rule bg-[var(--km-paper-warm)] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-[var(--km-ink-soft)]">
                Utvikling i valgt bransje
              </div>
              <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                {selectedItem.name}
              </div>
              <div className="text-[11px] text-[var(--km-ink-soft)]">
                {selectedItem.employed_latest != null && String(selectedItem.employed_latest) !== ""
                  ? `Sysselsatte: ${num(selectedItem.employed_latest)}`
                  : "Sysselsetting: ikke oppgitt"}
                {selectedItem.latest_year ? ` · ${selectedItem.latest_year}` : ""}
              </div>
            </div>
            <EmploymentChangeStat
              percent={selectedItem.percent_change}
              absolute={selectedItem.absolute_change}
              unit="sysselsatte"
            />
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <EmptySegmentState text={emptyForLeader("industry", segment)} />
      ) : (
        <ul className="mt-3 divide-y divide-[var(--km-rule-soft,var(--km-rule))]">
          {shown.map((it) => (
            <li key={it.slug}>
              <button
                type="button"
                aria-label={`Filtrer på bransje: ${it.name}`}
                onClick={() => onPickIndustry(it.slug)}
                className={cn(ROW_BUTTON, "flex items-center justify-between gap-3")}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                    {it.name}
                  </div>
                  <div className="text-[11px] text-[var(--km-ink-soft)]">
                    {it.employed_latest != null && String(it.employed_latest) !== ""
                      ? `Sysselsatte: ${num(it.employed_latest)}`
                      : "Sysselsetting: ikke oppgitt"}
                    {it.latest_year ? ` · ${it.latest_year}` : ""}
                  </div>
                </div>
                <EmploymentChangeStat
                  percent={it.percent_change}
                  absolute={it.absolute_change}
                  unit="sysselsatte"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > VISIBLE && (
        <button
          type="button"
          aria-label={expanded ? "Vis færre bransjer" : "Vis flere bransjer"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-3 text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
        >
          {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
        </button>
      )}
    </section>
  );
}

function RegionalSignalsSection({
  data,
  hasFilter,
  filterRegionCode,
  filterRegionLabel,
  onPickRegion,
}: {
  data: NonNullable<MarketOverviewPayload["regional_signals"]>;
  hasFilter: boolean;
  filterRegionCode?: string | null;
  filterRegionLabel?: string | null;
  onPickRegion: (code: string) => void;
}) {
  const [segment, setSegment] = useState<LeaderSegment>("spotlight");
  const [sortMode, setSortMode] = useState<SortMode>(defaultSortFor("spotlight"));
  const [expanded, setExpanded] = useState(false);

  const rawItems =
    segment === "growth"
      ? (data.growth_leaders ?? [])
      : segment === "decline"
        ? (data.decline_leaders ?? [])
        : (data.items ?? []);

  const filteredItems = useMemo(
    () =>
      rawItems.filter(
        (it) => !isSelectedRegionResult(it, filterRegionCode, filterRegionLabel),
      ),
    [rawItems, filterRegionCode, filterRegionLabel],
  );

  const items = useMemo(
    () => sortLeaders(filteredItems, segment, sortMode),
    [filteredItems, segment, sortMode],
  );

  const VISIBLE = 6;
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <section className={SECTION_CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<MapPin className="h-4 w-4" />}
          title={
            hasFilter
              ? "Områder som peker seg ut innenfor valgt utvalg"
              : "Områder som peker seg ut i datagrunnlaget"
          }
          subtitle={
            hasFilter
              ? "Stedene under er områder innenfor valgt utvalg."
              : "Trykk et område for å se filtrert markedsbilde."
          }
        />
        <div className="flex flex-col items-end gap-2">
          <SegmentedControl
            ariaLabel="Velg utvalg for områder"
            value={segment}
            options={LEADER_OPTIONS}
            onChange={(v) => {
              setSegment(v);
              setSortMode(defaultSortFor(v));
              setExpanded(false);
            }}
          />
          <SortToggle
            segment={segment}
            value={sortMode}
            onChange={setSortMode}
            ariaLabel="Sorteringsgrunnlag for områder"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptySegmentState text={emptyForLeader("region", segment)} />
      ) : (
        <ul className="mt-3 divide-y divide-[var(--km-rule-soft,var(--km-rule))]">
          {shown.map((it) => (
            <li key={it.region_code}>
              <button
                type="button"
                aria-label={`Filtrer på område: ${cleanRegionLabel(it.region_label)}`}
                onClick={() => onPickRegion(it.region_code)}
                className={cn(ROW_BUTTON, "flex items-center justify-between gap-3")}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                    {cleanRegionLabel(it.region_label)}
                  </div>
                  <div className="text-[11px] text-[var(--km-ink-soft)]">
                    {it.employed_latest != null && String(it.employed_latest) !== ""
                      ? `Sysselsatte: ${num(it.employed_latest)}`
                      : "Sysselsetting: ikke oppgitt"}
                    {it.latest_year ? ` · ${it.latest_year}` : ""}
                  </div>
                </div>
                <EmploymentChangeStat
                  percent={it.percent_change}
                  absolute={it.absolute_change}
                  unit="sysselsatte"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > VISIBLE && (
        <button
          type="button"
          aria-label={expanded ? "Vis færre områder" : "Vis flere områder"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-3 text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
        >
          {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
        </button>
      )}
    </section>
  );
}

function CareerDirectionsSection({
  data,
  currentOccupationUri,
  currentOccupationTitle,
  onOpenCareerDirection,
}: {
  data: NonNullable<MarketOverviewPayload["career_directions"]>;
  currentOccupationUri?: string | null;
  currentOccupationTitle?: string | null;
  onOpenCareerDirection: (p: { occupation_uri: string; title: string }) => void;
}) {
  const [segment, setSegment] = useState<LeaderSegment>("spotlight");
  const [sortMode, setSortMode] = useState<SortMode>(defaultSortFor("spotlight"));
  const [expanded, setExpanded] = useState(false);

  const rawItems =
    segment === "growth"
      ? (data.growth_leaders ?? [])
      : segment === "decline"
        ? (data.decline_leaders ?? [])
        : (data.items ?? []);

  const filteredItems = useMemo(
    () =>
      currentOccupationUri || currentOccupationTitle
        ? rawItems.filter(
            (it) =>
              !isSelectedOccupation(it, currentOccupationUri, currentOccupationTitle),
          )
        : rawItems,
    [rawItems, currentOccupationUri, currentOccupationTitle],
  );

  const items = useMemo(
    () => sortLeaders(filteredItems, segment, sortMode),
    [filteredItems, segment, sortMode],
  );

  const VISIBLE = 6;
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <section id="karriereretninger" className={cn(SECTION_CARD, "scroll-mt-24")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<Compass className="h-4 w-4" />}
          title="Karriereretninger som peker seg ut"
          subtitle="Trykk en retning for å åpne Karrierekompass."
        />
        <div className="flex flex-col items-end gap-2">
          <SegmentedControl
            ariaLabel="Velg utvalg for karriereretninger"
            value={segment}
            options={LEADER_OPTIONS}
            onChange={(v) => {
              setSegment(v);
              setSortMode(defaultSortFor(v));
              setExpanded(false);
            }}
          />
          <SortToggle
            segment={segment}
            value={sortMode}
            onChange={setSortMode}
            ariaLabel="Sorteringsgrunnlag for karriereretninger"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptySegmentState text={emptyForLeader("career", segment)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-4">
          {shown.map((it) => {
            const label = signalLabel(
              it.market_signal_level,
              it.market_signal_score ?? null,
            );
            const primaryIndustry = it.industries?.[0]?.name ?? null;
            const region = it.regional_signal?.region_label
              ? cleanRegionLabel(it.regional_signal.region_label)
              : null;
            const hasContext =
              toNum(it.context_percent_change) != null ||
              toNum(it.context_absolute_change) != null;
            return (
              <button
                key={it.occupation_uri}
                type="button"
                aria-label={`Åpne Karrierekompass for ${it.title}`}
                onClick={() =>
                  onOpenCareerDirection({
                    occupation_uri: it.occupation_uri,
                    title: it.title,
                  })
                }
                className={CARD_BUTTON}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold leading-tight text-[var(--km-ink)] capitalize">
                    {it.title}
                  </h4>
                  <span className={cn("text-[10px] shrink-0", chipClass(label))}>
                    {label}
                  </span>
                </div>
                {(primaryIndustry || region) && (
                  <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
                    {primaryIndustry}
                    {primaryIndustry && region ? " · " : ""}
                    {region}
                  </p>
                )}
                <div className="mt-1.5">
                  {hasContext ? (
                    <EmploymentChangeStat
                      percent={it.context_percent_change}
                      absolute={it.context_absolute_change}
                      unit="sysselsatte"
                    />
                  ) : (
                    <EmploymentChangeStat
                      percent={it.percent_change}
                      absolute={it.absolute_change_thousands}
                      unit="tusen sysselsatte"
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {items.length > VISIBLE && (
        <button
          type="button"
          aria-label={expanded ? "Vis færre karriereretninger" : "Vis flere karriereretninger"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-3 text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
        >
          {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
        </button>
      )}
    </section>
  );
}


// ---- Kompetanseområder som peker seg ut ----

type CompetenceSegment = "strongest" | "weakest" | "increase" | "decrease";

function competenceEmpty(segment: CompetenceSegment): string {
  if (segment === "weakest")
    return "Vi finner ikke nok sammenlignbare signaler i dette utvalget.";
  if (segment === "increase")
    return "Vi har ikke historikk nok til å vise økning i dette utvalget.";
  if (segment === "decrease")
    return "Vi har ikke historikk nok til å vise nedgang i dette utvalget.";
  return "Vi finner ingen tydelige signaler i dette utvalget.";
}

function CompetenceAreasSection({
  employerNeeds,
  sampleSkills,
  onPickDemandSignal,
  onOpenDetail,
}: {
  employerNeeds: NonNullable<MarketOverviewPayload["employer_needs"]>;
  sampleSkills: CompetenceAreaItem[];
  onPickDemandSignal: (n: EmployerNeedItem) => void;
  onOpenDetail: (d: DetailPayload) => void;
}) {
  const trendAvailable = employerNeeds.trend_available === true;
  const hasWeakest = (employerNeeds.weakest_signals?.length ?? 0) > 0
    || (!!employerNeeds.weakest_signals);

  const options = useMemo(() => {
    const opts: SegmentOption<CompetenceSegment>[] = [
      { value: "strongest", label: "Sterkest signal" },
    ];
    if (hasWeakest) opts.push({ value: "weakest", label: "Lavest signal" });
    if (trendAvailable) {
      opts.push({ value: "increase", label: "Størst økning" });
      opts.push({ value: "decrease", label: "Størst nedgang" });
    }
    return opts;
  }, [trendAvailable, hasWeakest]);

  const [segment, setSegment] = useState<CompetenceSegment>("strongest");
  const [expanded, setExpanded] = useState(false);

  const effectiveSegment: CompetenceSegment = options.some((o) => o.value === segment)
    ? segment
    : "strongest";

  const items: EmployerNeedItem[] =
    effectiveSegment === "weakest"
      ? (employerNeeds.weakest_signals ?? [])
      : effectiveSegment === "increase"
        ? (employerNeeds.largest_increases ?? [])
        : effectiveSegment === "decrease"
          ? (employerNeeds.largest_decreases ?? [])
          : (employerNeeds.strongest_signals ?? []);

  const hasAnyNho =
    (employerNeeds.strongest_signals?.length ?? 0) > 0 || options.length > 1;

  if (!hasAnyNho && sampleSkills.length === 0) return null;

  const VISIBLE = 12;
  const shown = expanded ? items : items.slice(0, VISIBLE);
  const isTrendSegment =
    effectiveSegment === "increase" || effectiveSegment === "decrease";

  return (
    <section id="kompetanseomrader" className={cn(SECTION_CARD, "scroll-mt-24")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<GraduationCap className="h-4 w-4" />}
          title="Kompetanseområder som peker seg ut"
          subtitle="Forstå hvilke fagområder, utdanningsnivåer og behovssignaler NHO-bedrifter peker på."
        />
        {hasAnyNho && options.length > 1 && (
          <SegmentedControl
            ariaLabel="Velg visning for kompetanseområder"
            value={effectiveSegment}
            options={options}
            onChange={(v) => {
              setSegment(v);
              setExpanded(false);
            }}
          />
        )}
      </div>

      {hasAnyNho && (
        <>
          {shown.length === 0 ? (
            <EmptySegmentState text={competenceEmpty(effectiveSegment)} />
          ) : isTrendSegment ? (
            <ul className="mt-3 divide-y divide-[var(--km-rule-soft,var(--km-rule))]">
              {shown.map((n, i) => {
                const displayLabel = n.label ?? humanizeSignalType(n.type);
                const pp = n.signal_change ?? n.value_change ?? null;
                return (
                  <li key={`${n.type ?? "n"}-${i}`}>
                    <article className="flex items-stretch gap-2">
                      <button
                        type="button"
                        aria-label={`Velg behovssignal: ${displayLabel}`}
                        onClick={() => onPickDemandSignal(n)}
                        className={cn(
                          ROW_BUTTON,
                          "flex flex-1 items-center justify-between gap-3",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--km-ink)] truncate">
                            {displayLabel}
                          </div>
                          <div className="text-[11px] text-[var(--km-ink-soft)]">
                            {humanizeSignalType(n.type)}
                          </div>
                        </div>
                        <SignalChangeStat
                          pp={pp}
                          relativePercent={n.signal_change_percent}
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={`Vis detaljer om ${displayLabel}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDetail({ kind: "employer_need", data: n });
                        }}
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center self-center",
                          "rounded-2 text-[var(--km-ink-soft)] hover:text-[var(--km-ink)]",
                          "hover:bg-[var(--km-paper-warm)] cursor-pointer",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                          "focus-visible:outline-[var(--km-blue)]",
                        )}
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </article>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="flex flex-wrap gap-1.5 mt-4">
              {shown.map((n, i) => {
                const displayLabel = n.label ?? humanizeSignalType(n.type);
                return (
                  <li key={`${n.type ?? "n"}-${i}`}>
                    <article className="inline-flex items-stretch">
                      <button
                        type="button"
                        aria-label={`Velg behovssignal: ${displayLabel}`}
                        onClick={() => onPickDemandSignal(n)}
                        className={cn(CHIP_BUTTON, "rounded-r-none border-r-0")}
                      >
                        {displayLabel}
                      </button>
                      <button
                        type="button"
                        aria-label={`Vis detaljer om ${displayLabel}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDetail({ kind: "employer_need", data: n });
                        }}
                        className={cn(
                          "inline-flex items-center justify-center border border-rule",
                          "rounded-2 rounded-l-none bg-white px-2 text-[var(--km-ink-soft)]",
                          "hover:text-[var(--km-ink)] hover:bg-[var(--km-paper-warm)]",
                          "cursor-pointer focus-visible:outline focus-visible:outline-2",
                          "focus-visible:outline-offset-2 focus-visible:outline-[var(--km-blue)]",
                        )}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > VISIBLE && (
            <button
              type="button"
              aria-label={expanded ? "Vis færre" : "Vis flere"}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="mt-3 text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
            >
              {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
            </button>
          )}
          <p className="text-[11px] text-[var(--km-ink-soft)] mt-3">
            Kilde: NHO Kompetansebarometeret.
          </p>
        </>
      )}

      {sampleSkills.length > 0 && (
        <div className={cn("space-y-2", hasAnyNho && "mt-6 pt-5 border-t border-rule")}>
          <div>
            <h4 className="text-sm font-semibold text-[var(--km-ink)]">
              Eksempler på konkrete kompetanser
            </h4>
            <p className="text-xs text-[var(--km-ink-soft)] mt-0.5">
              Kompetanser hentet fra karriereretningene i utvalget.
            </p>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {sampleSkills.map((c) => (
              <li key={c.uri}>
                <button
                  type="button"
                  aria-label={`Vis detaljer for kompetanse: ${c.label}`}
                  onClick={() => onOpenDetail({ kind: "skill", data: c })}
                  className={CHIP_BUTTON}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}



// ---- Kompetansekrav i valgt utvalg (ESCO/STYRK fra RPC get_industry_skill_signals) ----

type SkillSignalSegment =
  | "common"
  | "less_common"
  | "essential"
  | "optional";

const SKILL_SIGNAL_OPTIONS: SegmentOption<SkillSignalSegment>[] = [
  { value: "common", label: "Vanligste krav" },
  { value: "less_common", label: "Mindre vanlige krav" },
  { value: "essential", label: "Må-ha-kompetanser" },
  { value: "optional", label: "Kompetanser som styrker profilen" },
];

function skillSignalEmpty(segment: SkillSignalSegment): string {
  if (segment === "less_common")
    return "Vi finner ingen mer spesialiserte kompetansekrav i dette utvalget.";
  if (segment === "essential")
    return "Vi finner ingen tydelige må-ha-kompetanser i dette utvalget.";
  if (segment === "optional")
    return "Vi finner ingen kompetanser som tydelig styrker profilen i dette utvalget.";
  return "Vi finner ingen tydelige kompetansekrav i dette utvalget.";
}

function formatCoverage(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v.toFixed(v >= 10 ? 0 : 1).replace(".", ",")} %`;
}

function IndustrySkillSignalsSection({
  data,
  isLoading,
  onOpenCareerDirection,
}: {
  data: IndustrySkillSignalsPayload | null;
  isLoading: boolean;
  onOpenCareerDirection: (p: { occupation_uri: string; title: string }) => void;
}) {
  const [segment, setSegment] = useState<SkillSignalSegment>("common");
  const [expanded, setExpanded] = useState(false);
  const [openExamples, setOpenExamples] = useState<string | null>(null);

  const items: IndustrySkillSignalItem[] = useMemo(() => {
    if (!data) return [];
    switch (segment) {
      case "less_common":
        return data.less_common_requirements ?? [];
      case "essential":
        return data.essential_requirements ?? [];
      case "optional":
        return data.optional_requirements ?? [];
      default:
        return data.common_requirements ?? [];
    }
  }, [data, segment]);

  const hasAny =
    (data?.common_requirements?.length ?? 0) +
      (data?.less_common_requirements?.length ?? 0) +
      (data?.essential_requirements?.length ?? 0) +
      (data?.optional_requirements?.length ?? 0) >
    0;

  if (!isLoading && !hasAny) return null;

  const VISIBLE = 12;
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <section className={cn(SECTION_CARD, "scroll-mt-24")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          icon={<Sparkles className="h-4 w-4" />}
          title="Kompetansekrav i valgt utvalg"
          subtitle="Konkrete kompetanser som går igjen i karriereretningene i utvalget."
        />
        <SegmentedControl
          ariaLabel="Velg visning for kompetansekrav"
          value={segment}
          options={SKILL_SIGNAL_OPTIONS}
          onChange={(v) => {
            setSegment(v);
            setExpanded(false);
            setOpenExamples(null);
          }}
        />
      </div>

      {isLoading && !hasAny ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Henter kompetansekrav…
        </div>
      ) : shown.length === 0 ? (
        <EmptySegmentState text={skillSignalEmpty(segment)} />
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((item, i) => {
            const key = `${item.uri ?? item.label}-${i}`;
            const isOpen = openExamples === key;
            const examples = item.example_occupations ?? [];
            const coverage = formatCoverage(item.coverage_percent);
            const countLabel =
              item.occupation_count != null && item.total_occupations != null
                ? `${item.occupation_count} av ${item.total_occupations} karriereretninger`
                : item.occupation_count != null
                  ? `${item.occupation_count} karriereretninger`
                  : null;
            return (
              <li
                key={key}
                className="border border-rule rounded-2 bg-white p-3 md:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--km-ink)]">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-[var(--km-ink-soft)] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {countLabel && <span>{countLabel}</span>}
                      {coverage && <span>Dekning: {coverage}</span>}
                    </div>
                  </div>
                  {examples.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpenExamples(isOpen ? null : key)}
                      className="text-xs text-[var(--km-blue)] hover:underline cursor-pointer whitespace-nowrap"
                      aria-expanded={isOpen}
                    >
                      {isOpen
                        ? "Skjul stillinger"
                        : `Se stillinger som bruker denne kompetansen (${examples.length})`}
                    </button>
                  )}
                </div>
                {isOpen && examples.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 mt-3">
                    {examples.map((o) => (
                      <li key={`${key}-${o.occupation_uri}`}>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCareerDirection({
                              occupation_uri: o.occupation_uri,
                              title: o.title,
                            })
                          }
                          className={CHIP_BUTTON}
                          aria-label={`Åpne karrierekompass for ${o.title}`}
                        >
                          {o.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs text-[var(--km-blue)] hover:underline cursor-pointer"
        >
          {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
        </button>
      )}
      <p className="text-[11px] text-[var(--km-ink-soft)] mt-3">
        Kilde: ESCO/STYRK-kompetansekrav for karriereretningene i utvalget.
      </p>
    </section>
  );
}

function explorationAction(type?: string | null): ExplorationAction | null {
  const t = (type ?? "").toLowerCase();
  if (t.includes("region")) return "focus_region";
  if (t.includes("industry") || t.includes("bransje")) return "focus_industry";
  if (t.includes("occupation") || t.includes("yrke") || t.includes("stilling"))
    return "focus_search";
  if (t.includes("competence") || t.includes("kompetanse")) return "scroll_competence";
  if (t.includes("career") || t.includes("retning")) return "scroll_careers";
  if (t.includes("data")) return "scroll_data";
  return null;
}

function runExploration(a: ExplorationAction, h: MarketOverviewHandlers) {
  switch (a) {
    case "focus_region":
      h.onFocusRegion();
      return;
    case "focus_industry":
      h.onFocusIndustry();
      return;
    case "focus_search":
      h.onFocusSearch();
      return;
    case "scroll_competence":
      document.getElementById("kompetanseomrader")?.scrollIntoView({ behavior: "smooth" });
      return;
    case "scroll_careers":
      document.getElementById("karriereretninger")?.scrollIntoView({ behavior: "smooth" });
      return;
    case "scroll_data":
      document.getElementById("datagrunnlag")?.scrollIntoView({ behavior: "smooth" });
      return;
  }
}

function SuggestedExplorationsSection({
  items,
  handlers,
}: {
  items: SuggestedExploration[];
  handlers: MarketOverviewHandlers;
}) {
  if (items.length === 0) return null;
  return (
    <section className={SECTION_CARD}>
      <SectionHead
        icon={<Lightbulb className="h-4 w-4" />}
        title="Forslag til utforsking"
      />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-4">
        {items.map((it, i) => {
          const action = explorationAction(it.type);
          if (!action) {
            return (
              <div
                key={i}
                className="border border-rule rounded-2 bg-[var(--km-paper-warm)] p-3 md:p-4"
              >
                <h4 className="text-sm font-semibold text-[var(--km-ink)] leading-tight">
                  {it.title ?? "Forslag"}
                </h4>
                {it.description && (
                  <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
                    {it.description}
                  </p>
                )}
              </div>
            );
          }
          return (
            <button
              key={i}
              type="button"
              aria-label={it.action_label ?? it.title ?? "Utforsk"}
              onClick={() => runExploration(action, handlers)}
              className={CARD_BUTTON}
            >
              <h4 className="text-sm font-semibold text-[var(--km-ink)] leading-tight">
                {it.title ?? it.action_label ?? "Utforsk"}
              </h4>
              {it.description && (
                <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
                  {it.description}
                </p>
              )}
              {it.action_label && (
                <span className="text-[11px] text-[var(--km-blue)] mt-2 inline-block">
                  {it.action_label} →
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================
// NAV + SSB markedskapasitet (RPC + view)
// ============================================================

function BalanceChip({
  tone,
  label,
}: {
  tone: MarketBalanceTone;
  label: string;
}) {
  const cls =
    tone === "success"
      ? "km-chip km-chip-success"
      : tone === "warning"
        ? "km-chip km-chip-warning"
        : "km-chip";
  return <span className={cls}>{label}</span>;
}

const MARKET_CAPACITY_FOOTNOTE =
  "Basert på NAV Bedriftsundersøkelsen, NAV helt ledige, NAV ledige stillinger og SSB lønnsstatistikk. Tallene er indikatorer, ikke garanti for enkeltpersoner.";

const MARKET_CAPACITY_FALLBACK_SOURCES =
  "NAV Bedriftsundersøkelsen · NAV helt ledige · NAV ledige stillinger · SSB lønnsstatistikk";

export function OccupationMarketCapacitySection({
  occupationUri,
  title,
  query: queryText,
  salaryIndustrySlug = null,
  salaryIndustryName = null,
  salaryIndustrySource = "none",
}: {
  occupationUri?: string | null;
  title?: string | null;
  query?: string | null;
  salaryIndustrySlug?: string | null;
  salaryIndustryName?: string | null;
  salaryIndustrySource?: SalaryIndustrySource;
}) {
  const searchText =
    (occupationUri && occupationUri.trim().length > 0 && occupationUri) ||
    (title && title.trim().length > 0 && title) ||
    (queryText && queryText.trim().length > 0 && queryText) ||
    null;
  const enabled = !!searchText && searchText.trim().length >= 2;

  const query = useQuery({
    queryKey: ["market-capacity", searchText ?? null],
    enabled,
    queryFn: async (): Promise<MarketCapacityRpcPayload> => {
      const { data, error } = await supabase.rpc(
        "get_public_market_capacity",
        { search_text: searchText, result_limit: 10 },
      );
      if (error) throw new Error(error.message);
      return (data ?? { found: false, items: [] }) as MarketCapacityRpcPayload;
    },
  });

  const item = useMemo<MarketCapacityItem | null>(() => {
    const items = query.data?.items ?? [];
    if (items.length === 0) return null;
    if (occupationUri) {
      const match = items.find((it) => it.occupation_uri === occupationUri);
      if (match) return match;
    }
    return items[0];
  }, [query.data, occupationUri]);

  const payload = query.data;
  const noData =
    !query.isLoading &&
    !query.error &&
    !!payload &&
    (payload.found === false || (payload.items ?? []).length === 0);

  const showSalary = salaryIndustrySource !== "none";

  const salaryDisplayName = salaryIndustryName ?? "valgt næring";
  const embeddedExplanation =
    salaryIndustrySource === "filter"
      ? `Tallene under viser offisielle SSB-tall for ${salaryDisplayName}, siden du har valgt denne bransjen.`
      : salaryIndustrySource === "fallback"
        ? `SSB publiserer utdannings- og aldersfordelt lønn etter næring, ikke direkte etter ESCO-stilling. Derfor vises tall for næringen som ligger nærmest denne stillingen: ${salaryDisplayName}.`
        : undefined;

  return (
    <section id="arbeidsmarked" className={cn(SECTION_CARD, "scroll-mt-24")}>
      <SectionHead
        icon={<Briefcase className="h-4 w-4" />}
        title="Lønn i stilling"
        subtitle="NAV- og SSB-indikatorer for stillingen, samt SSB-lønn for nærmeste næring."
      />
      {query.isLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter markedsdata …
        </div>
      )}
      {!query.isLoading && query.error && (
        <EmptySegmentState text="Vi klarte ikke å hente markedsdata akkurat nå." />
      )}
      {noData && (
        <EmptySegmentState text="Vi har ikke nok NAV-data for dette yrket ennå." />
      )}
      {!query.isLoading && !query.error && item && (
        <MarketCapacityBody item={item} />
      )}
      {showSalary && (
        <SalaryProfileSection
          industrySlug={salaryIndustrySlug}
          industryName={salaryIndustryName}
          source={salaryIndustrySource}
          variant="embedded"
          embeddedTitle="Lønnsvariasjon etter utdanning og alder"
          embeddedExplanation={embeddedExplanation}
        />
      )}
    </section>
  );
}

function Briefcase(props: React.SVGProps<SVGSVGElement>) {
  // Reuse lucide Building2 visual by importing? Simpler: inline tiny icon.
  return <Building2 {...props} />;
}

function MarketCapacityBody({ item }: { item: MarketCapacityItem }) {
  const balance = marketBalanceLabel(item.shortage_to_unemployed_ratio);
  const noSalary =
    !hasValue(item.salary_median_all) &&
    !hasValue(item.salary_median_private) &&
    !hasValue(item.salary_median_state) &&
    !hasValue(item.salary_median_municipal);
  const periodLine = formatPeriodLine(item);
  const styrk = item.styrk_market_signals?.[0];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Estimert mangel"
          value={formatNumberOrEmpty(item.shortage_count)}
        />
        <KpiCard
          label="Helt ledige"
          value={formatNumberOrEmpty(item.unemployed_count)}
        />
        <KpiCard
          label="Tilgang ledige stillinger"
          value={formatNumberOrEmpty(item.vacancy_count)}
        />
        <KpiCard
          label="Median månedslønn"
          value={formatSalaryKrPerMonth(item.salary_median_all)}
        />
      </div>

      {!noSalary && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--km-ink-soft)] mr-1">
            Etter sektor:
          </span>
          {hasValue(item.salary_median_private) && (
            <span className="km-chip">
              Privat {formatSalaryKrPerMonth(item.salary_median_private)}
            </span>
          )}
          {hasValue(item.salary_median_state) && (
            <span className="km-chip">
              Stat {formatSalaryKrPerMonth(item.salary_median_state)}
            </span>
          )}
          {hasValue(item.salary_median_municipal) && (
            <span className="km-chip">
              Kommune {formatSalaryKrPerMonth(item.salary_median_municipal)}
            </span>
          )}
        </div>
      )}

      {noSalary && (
        <p className="text-xs text-[var(--km-ink-soft)]">
          SSB har ikke publiserbar lønnsstatistikk for dette yrket i valgt
          detaljnivå.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
        <span className="text-xs text-[var(--km-ink-soft)]">Markedsbalanse:</span>
        <BalanceChip tone={balance.tone} label={balance.label} />
        {hasValue(item.shortage_to_unemployed_ratio) && (
          <span className="text-xs text-[var(--km-ink-soft)]">
            {item.shortage_to_unemployed_ratio.toFixed(2)} mangel pr. helt ledig
          </span>
        )}
      </div>

      <div className="text-[11px] font-mono text-[var(--km-ink-soft)]">
        {periodLine ?? MARKET_CAPACITY_FALLBACK_SOURCES}
      </div>
      {styrk?.styrk_code && (
        <div className="text-[11px] text-[var(--km-ink-soft)]">
          Kildekobling: STYRK {styrk.styrk_code}
        </div>
      )}
      <p className="text-xs text-[var(--km-ink-soft)] leading-snug">
        {MARKET_CAPACITY_FOOTNOTE}
      </p>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-rule rounded-2 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--km-ink-soft)] font-mono">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--km-ink)]">
        {value}
      </div>
    </div>
  );
}

type CapacitySegment =
  | "shortage"
  | "unemployed"
  | "vacancies"
  | "tightness"
  | "salary";

const CAPACITY_OPTIONS: SegmentOption<CapacitySegment>[] = [
  { value: "shortage", label: "Størst mangel" },
  { value: "unemployed", label: "Flest helt ledige" },
  { value: "vacancies", label: "Flest ledige stillinger" },
  { value: "tightness", label: "Strammest marked" },
  { value: "salary", label: "Høyest lønn" },
];

function ScopeTag({ scope, showNational }: { scope?: string | null; showNational: boolean }) {
  const s = (scope ?? "").toLowerCase();
  if (s === "regional") {
    return (
      <span className="ml-1 inline-flex items-center rounded-2 border border-rule px-1 py-0.5 text-[10px] text-[var(--km-ink-soft)] font-mono">
        regionalt
      </span>
    );
  }
  if (s === "national" && showNational) {
    return (
      <span className="ml-1 inline-flex items-center rounded-2 border border-rule px-1 py-0.5 text-[10px] text-[var(--km-ink-soft)] font-mono">
        nasjonalt
      </span>
    );
  }
  return null;
}

function MarketCapacityOverviewSection({
  onSearchOccupation,
  onSourcesLoaded,
  regionCode,
  industrySlug,
}: {
  onSearchOccupation?: (title: string) => void;
  onSourcesLoaded?: (sources: DataSource[]) => void;
  regionCode: string | null;
  industrySlug: string | null;
}) {
  const [segment, setSegment] = useState<CapacitySegment>("shortage");

  const query = useQuery({
    queryKey: ["market-capacity-overview", segment, regionCode, industrySlug],
    queryFn: async (): Promise<MarketCapacityOverviewPayload> => {
      const { data, error } = await supabase.rpc(
        "get_public_market_capacity_overview",
        {
          segment,
          result_limit: 8,
          filter_region_code: regionCode,
          filter_industry_slug: industrySlug,
        },
      );
      if (error) throw new Error(error.message);
      return (data ?? { found: false, segment, items: [] }) as MarketCapacityOverviewPayload;
    },
  });

  useEffect(() => {
    if (onSourcesLoaded && query.data?.data_sources) {
      onSourcesLoaded(query.data.data_sources as DataSource[]);
    }
  }, [query.data, onSourcesLoaded]);

  const payload = query.data;
  const rows = payload?.items ?? [];
  const periodLine =
    (payload?.source_line_parts ?? [])
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .join(" · ") || null;

  const appliedFilters = payload?.applied_filters ?? null;
  const isFiltered = appliedFilters?.is_filtered === true;
  const scopeNote =
    payload?.scope_note ??
    (isFiltered
      ? "Yrkeslisten er avgrenset til valgt utvalg. Markedstallene er nasjonale indikatorer, regionalt der tilgjengelig."
      : null);

  const regionalGroups = payload?.regional_unemployment_groups ?? [];
  const showNationalTag = !!regionCode;

  let emptyText = "Vi finner ikke nok markedsdata ennå.";
  if (industrySlug) emptyText = "Vi finner ikke nok yrkesdata for valgt bransje.";
  else if (regionCode) emptyText = "Vi finner ikke nok yrkesdata for valgt område.";

  return (
    <section className={cn(SECTION_CARD, "scroll-mt-24")}>
      <SectionHead
        icon={<Building2 className="h-4 w-4" />}
        title="Arbeidsmarkedet akkurat nå"
        subtitle="Nasjonal indikator for mangel, ledighet, ledige stillinger og månedslønn per yrke, regionalt der tilgjengelig."
      />
      <div className="mt-3">
        <SegmentedControl<CapacitySegment>
          value={segment}
          options={CAPACITY_OPTIONS}
          onChange={setSegment}
          ariaLabel="Velg sortering"
        />
      </div>

      {scopeNote && (
        <p className="mt-3 text-xs text-[var(--km-ink-soft)] leading-snug">
          {scopeNote}
        </p>
      )}

      {isFiltered && (appliedFilters?.industry_name || appliedFilters?.region_label) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--km-ink-soft)]">Filtrert på:</span>
          {appliedFilters?.industry_name && (
            <span className="inline-flex items-center rounded-2 border border-rule bg-[var(--km-paper-warm)] px-2.5 py-1 text-xs text-[var(--km-ink)]">
              Bransje: {appliedFilters.industry_name}
            </span>
          )}
          {appliedFilters?.region_label && (
            <span className="inline-flex items-center rounded-2 border border-rule bg-[var(--km-paper-warm)] px-2.5 py-1 text-xs text-[var(--km-ink)]">
              Område: {cleanRegionLabel(appliedFilters.region_label)}
            </span>
          )}
        </div>
      )}

      {query.isLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter …
        </div>
      )}
      {!query.isLoading && query.error && (
        <EmptySegmentState text="Vi klarte ikke å hente markedsdata akkurat nå." />
      )}
      {!query.isLoading && !query.error && rows.length === 0 && (
        <EmptySegmentState text={emptyText} />
      )}
      {!query.isLoading && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--km-ink-soft)] font-mono">
                <th className="py-2 pr-3 font-normal">Yrke</th>
                <th className="py-2 pr-3 font-normal text-right">Mangel</th>
                <th className="py-2 pr-3 font-normal text-right">Helt ledige</th>
                <th
                  className="py-2 pr-3 font-normal text-right"
                  title="Tilgang ledige stillinger (NAV)"
                >
                  Ledige stillinger
                </th>
                <th className="py-2 pr-3 font-normal text-right">Median lønn</th>
                <th className="py-2 pr-3 font-normal">Markedsbalanse</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const bal = marketBalanceLabel(row.shortage_to_unemployed_ratio);
                const title = row.styrk_title ?? "";
                const clickable = !!onSearchOccupation && title.length > 0;
                return (
                  <tr
                    key={`${row.styrk_code ?? title}-${i}`}
                    className={cn(
                      "border-t border-rule",
                      clickable &&
                        "cursor-pointer hover:bg-[var(--km-paper-warm)]",
                    )}
                    onClick={
                      clickable
                        ? () => onSearchOccupation!(title)
                        : undefined
                    }
                  >
                    <td className="py-2 pr-3 text-[var(--km-ink)]">{title}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatNumberOrEmpty(row.shortage_count, "—")}
                      <ScopeTag scope={row.shortage_scope} showNational={showNationalTag} />
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatNumberOrEmpty(row.unemployed_count, "—")}
                      <ScopeTag scope={row.unemployment_scope} showNational={showNationalTag} />
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatNumberOrEmpty(row.vacancy_count, "—")}
                      <ScopeTag scope={row.vacancy_scope} showNational={showNationalTag} />
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatSalaryKrPerMonth(row.salary_median_all, "—")}
                      <ScopeTag scope={row.salary_scope} showNational={showNationalTag} />
                    </td>
                    <td className="py-2 pr-3">
                      <BalanceChip tone={bal.tone} label={bal.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {regionalGroups.length > 0 && (
        <div className="mt-6 border-t border-rule pt-4">
          <h4 className="text-sm font-semibold text-[var(--km-ink)]">
            Regional ledighet i brede yrkesgrupper
          </h4>
          <p className="mt-1 text-xs text-[var(--km-ink-soft)] leading-snug">
            NAV har regionale tall på brede yrkesgrupper her. De vises som kontekst, ikke som eksakte tall for enkeltstillinger.
          </p>
          <ul className="mt-3 divide-y divide-[var(--km-rule)] border border-rule rounded-2">
            {regionalGroups.map((g, i) => (
              <li
                key={`${g.label}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="text-[var(--km-ink)]">{g.label}</span>
                <span className="text-xs text-[var(--km-ink-soft)] font-mono tabular-nums">
                  {formatNumberOrEmpty(typeof g.value === "string" ? Number(g.value) : g.value, "—")}
                  {g.region_label ? ` · ${cleanRegionLabel(g.region_label)}` : ""}
                  {g.period ? ` · ${g.period}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 text-[11px] font-mono text-[var(--km-ink-soft)]">
        {periodLine ?? MARKET_CAPACITY_FALLBACK_SOURCES}
      </div>
      <p className="mt-2 text-xs text-[var(--km-ink-soft)] leading-snug">
        {MARKET_CAPACITY_FOOTNOTE}
      </p>
    </section>
  );
}


function DataSourcesSection({
  sources,
  notes,
  onOpenDetail,
}: {
  sources: DataSource[];
  notes: string[];
  onOpenDetail: (d: DetailPayload) => void;
}) {
  const visibleSources = sources.filter(shouldRenderDataSource);
  if (visibleSources.length === 0 && notes.length === 0) return null;
  return (
    <section id="datagrunnlag" className={cn(SECTION_CARD, "scroll-mt-24")}>
      <SectionHead
        icon={<Database className="h-4 w-4" />}
        title="Datagrunnlag og forbehold"
        subtitle="Åpne datakilder som ligger til grunn for markedsbildet."
      />
      {visibleSources.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 mt-4">
          {visibleSources.map((s, i) => {
            const heading = resolveDataSourceHeading(s);
            const body = resolveDataSourceBody(s);
            return (
              <button
                key={i}
                type="button"
                aria-label={`Vis detaljer for datakilde: ${heading}`}
                onClick={() => onOpenDetail({ kind: "data_source", data: s })}
                className={CARD_BUTTON}
              >
                <h4 className="text-sm font-semibold text-[var(--km-ink)] leading-tight">
                  {heading}
                </h4>
                {body && (
                  <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug line-clamp-2">
                    {body}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs text-[var(--km-ink-soft)]">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// DetailDrawer
// ============================================================

export function DetailDrawer({
  detail,
  onClose,
  onPickIndustry,
  onPickRegion,
  onScrollToCareers,
}: {
  detail: DetailPayload | null;
  onClose: () => void;
  onPickIndustry: (slug: string) => void;
  onPickRegion: (code: string) => void;
  onScrollToCareers: () => void;
}) {
  return (
    <Sheet open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg bg-[var(--km-paper)] border-l border-rule p-0"
      >
        <div className="flex h-full flex-col">
          <div className="p-6 border-b border-rule">
            {detail?.kind === "skill" && <SkillHeader item={detail.data} />}
            {detail?.kind === "employer_need" && (
              <EmployerNeedHeader item={detail.data} />
            )}
            {detail?.kind === "data_source" && (
              <DataSourceHeader item={detail.data} />
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {detail?.kind === "skill" && <SkillBody item={detail.data} />}
            {detail?.kind === "employer_need" && (
              <EmployerNeedBody
                item={detail.data}
                onPickIndustry={(s) => {
                  onClose();
                  onPickIndustry(s);
                }}
                onPickRegion={(c) => {
                  onClose();
                  onPickRegion(c);
                }}
                onScrollToCareers={() => {
                  onClose();
                  onScrollToCareers();
                }}
              />
            )}
            {detail?.kind === "data_source" && <DataSourceBody item={detail.data} />}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SkillHeader({ item }: { item: CompetenceAreaItem }) {
  return (
    <SheetHeader>
      <SheetTitle className="text-[var(--km-ink)]">{item.label}</SheetTitle>
      <SheetDescription>Kompetanseområde fra datagrunnlaget.</SheetDescription>
    </SheetHeader>
  );
}

function SkillBody({ item }: { item: CompetenceAreaItem }) {
  return (
    <>
      <dl className="text-sm space-y-2">
        {item.occupation_count != null && (
          <Row label="Forekommer i" value={`${num(item.occupation_count)} yrker`} />
        )}
        {item.weight != null && (
          <Row label="Relativ vekt" value={item.weight.toFixed(2)} />
        )}
        {item.source && <Row label="Kilde" value={item.source} />}
        {item.context && <Row label="Kontekst" value={item.context} />}
      </dl>
      <div className="border border-rule rounded-2 bg-white p-3 text-xs text-[var(--km-ink-soft)]">
        Fullt kompetansesøk kommer i en senere fase.
      </div>
      <Button variant="outline" disabled className="w-full">
        Se stillinger som bruker denne kompetansen
      </Button>
    </>
  );
}

function EmployerNeedHeader({ item }: { item: EmployerNeedItem }) {
  return (
    <SheetHeader>
      <SheetTitle className="text-[var(--km-ink)]">
        {item.label ?? humanizeSignalType(item.type)}
      </SheetTitle>
      <SheetDescription>{humanizeSignalType(item.type)}</SheetDescription>
    </SheetHeader>
  );
}

function EmployerNeedBody({
  item,
  onPickIndustry,
  onPickRegion,
  onScrollToCareers,
}: {
  item: EmployerNeedItem;
  onPickIndustry: (slug: string) => void;
  onPickRegion: (code: string) => void;
  onScrollToCareers: () => void;
}) {
  const level = signalLabel(item.level, item.value ?? item.high_intensity_value ?? null);
  return (
    <>
      <div>
        <span className={chipClass(level)}>{level}</span>
      </div>
      <dl className="text-sm space-y-2">
        {item.scope && <Row label="Omfang" value={item.scope} />}
        {item.year && <Row label="Årgang" value={String(item.year)} />}
        {item.industry_name_no && (
          <Row label="Bransje" value={item.industry_name_no} />
        )}
        {item.region_label && (
          <Row label="Område" value={cleanRegionLabel(item.region_label)} />
        )}
        <Row label="Kilde" value="NHO Kompetansebarometeret" />
      </dl>
      <div className="flex flex-col gap-2 pt-2">
        {item.industry_slug && (
          <Button
            variant="outline"
            onClick={() => onPickIndustry(item.industry_slug!)}
          >
            Velg bransje
          </Button>
        )}
        {item.region_code && (
          <Button
            variant="outline"
            onClick={() => onPickRegion(item.region_code!)}
          >
            Velg område
          </Button>
        )}
        <Button onClick={onScrollToCareers}>
          Se relevante karriereretninger
        </Button>
      </div>
    </>
  );
}

function DataSourceHeader({ item }: { item: DataSource }) {
  const heading = resolveDataSourceHeading(item);
  const href = item.source_url ?? item.url ?? null;
  return (
    <SheetHeader>
      <SheetTitle className="text-[var(--km-ink)]">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-rule underline-offset-4 hover:text-[var(--km-blue)]"
          >
            {heading}
          </a>
        ) : (
          heading
        )}
      </SheetTitle>
      {item.provider && item.provider !== heading && (
        <SheetDescription>{item.provider}</SheetDescription>
      )}
    </SheetHeader>
  );
}

function DataSourceBody({ item }: { item: DataSource }) {
  const body = resolveDataSourceBody(item);
  const href = item.source_url ?? item.url ?? null;
  return (
    <>
      <dl className="text-sm space-y-2">
        {item.version && <Row label="Versjon" value={item.version} />}
        {item.imported_at && <Row label="Importert" value={item.imported_at} />}
      </dl>
      {body && (
        <p className="text-sm text-[var(--km-ink-soft)] leading-relaxed">
          {body}
        </p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[var(--km-blue)] underline"
        >
          Åpne kilde
        </a>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--km-rule-soft,var(--km-rule))] pb-1.5">
      <dt className="text-[var(--km-ink-soft)]">{label}</dt>
      <dd className="text-[var(--km-ink)] text-right">{value}</dd>
    </div>
  );
}

// ============================================================
// FindOutSection (replaces substring-based one)
// ============================================================

type FindOutCard = {
  id: string;
  title: string;
  description: string;
  action: ExplorationAction;
};

const FIND_OUT_CARDS: FindOutCard[] = [
  {
    id: "region",
    title: "Hva preger ditt område?",
    description: "Velg område for å se filtrert markedsbilde.",
    action: "focus_region",
  },
  {
    id: "industry",
    title: "Hva preger en bransje?",
    description: "Velg bransje for å snevre inn.",
    action: "focus_industry",
  },
  {
    id: "occupation",
    title: "Utforsk en konkret stilling",
    description: "Søk på en stilling og åpne Karrierekompass.",
    action: "focus_search",
  },
  {
    id: "competence",
    title: "Hvilke kompetanser går igjen?",
    description: "Se kompetanseområder i datagrunnlaget.",
    action: "scroll_competence",
  },
  {
    id: "careers",
    title: "Hvilke karriereretninger peker seg ut?",
    description: "Se retninger med tydelige markedssignaler.",
    action: "scroll_careers",
  },
  {
    id: "data",
    title: "Hvor kommer dataene fra?",
    description: "Les om datakilder og forbehold.",
    action: "scroll_data",
  },
];

export function FindOutSection({ handlers }: { handlers: MarketOverviewHandlers }) {
  return (
    <section className="space-y-3" id="hva-kan-du-finne-ut">
      <div>
        <h3 className="text-base md:text-lg font-semibold flex items-center gap-2 text-[var(--km-ink)]">
          <span className="text-[var(--km-ink-soft)]">
            <Sparkles className="h-4 w-4" />
          </span>
          Hva kan du finne ut?
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIND_OUT_CARDS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.title}
            onClick={() => runExploration(c.action, handlers)}
            className={CARD_BUTTON}
          >
            <div className="text-sm font-semibold text-[var(--km-ink)] leading-tight">
              {c.title}
            </div>
            <p className="text-xs text-[var(--km-ink-soft)] mt-1.5 leading-snug">
              {c.description}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

