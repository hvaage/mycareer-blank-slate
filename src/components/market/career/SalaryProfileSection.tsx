// ============================================================
// SSB salary profile section (tabell 11420 + 11421)
// ============================================================
//
// Standalone-variant: brukes i markedsoversikten — egen card-section.
// Embedded-variant:  brukes på yrkesdetalj inne i «Arbeidsmarked og lønn».
//                    Render uten ytre section-card, kun border-t + h3/h4.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  supabase,
  type SalaryProfilePayload,
  type SalarySeriesRow,
  type SalaryKpi,
} from "@/lib/market";
import type { SalaryIndustrySource } from "@/lib/market/salaryProfile";

// ----- Options -----

const SALARY_EDU_OPTIONS = [
  { value: "__all", label: "Alle utdanningsnivåer" },
  { value: "1-2", label: "Grunnskole" },
  { value: "3-5", label: "Videregående" },
  { value: "6", label: "Universitet/høgskole, lavere nivå" },
  { value: "7-8", label: "Universitet/høgskole, høyere nivå" },
];
const SALARY_AGE_OPTIONS = [
  { value: "__all", label: "Alle aldersgrupper" },
  { value: "00-24", label: "Under 25 år" },
  { value: "25-29", label: "25–29 år" },
  { value: "30-34", label: "30–34 år" },
  { value: "35-39", label: "35–39 år" },
  { value: "40-44", label: "40–44 år" },
  { value: "45-49", label: "45–49 år" },
  { value: "50-54", label: "50–54 år" },
  { value: "55-59", label: "55–59 år" },
  { value: "60-", label: "60 år og over" },
];
const SALARY_GENDER_OPTIONS = [
  { value: "0", label: "Begge kjønn" },
  { value: "2", label: "Kvinner" },
  { value: "1", label: "Menn" },
];
const SALARY_SECTOR_OPTIONS = [
  { value: "ALLE", label: "Alle sektorer" },
  { value: "A+B+D+E", label: "Privat sektor og offentlig eide foretak" },
  { value: "6500", label: "Kommuneforvaltningen" },
  { value: "6100", label: "Statsforvaltningen" },
];
const SALARY_WORKING_TIME_OPTIONS = [
  { value: "0", label: "Alle arbeidstider" },
  { value: "5", label: "Heltidsansatte" },
  { value: "6", label: "Deltidsansatte" },
];

const SALARY_METHOD_FALLBACK =
  "SSB publiserer ikke alder og utdanning kombinert i disse tabellene. Tallene vises derfor som to separate sammenligninger.";

const SECTION_CARD = "border border-rule rounded-3 bg-white p-5 md:p-6";

// ----- Format helpers -----

function formatKrPerMonth(v?: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${new Intl.NumberFormat("nb-NO").format(Math.round(v))} kr/mnd`;
}
function formatKrShort(v?: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${new Intl.NumberFormat("nb-NO").format(Math.round(v))} kr`;
}
function formatQuartileRange(lo?: number | null, hi?: number | null): string | null {
  if (lo == null || hi == null) return null;
  return `Kvartilspenn: ${formatKrShort(lo)} – ${formatKrShort(hi)}`;
}
function formatEmploymentBasis(n?: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `Basert på ${new Intl.NumberFormat("nb-NO").format(n)} arbeidsforhold`;
}

function isAllRow(row: SalarySeriesRow): boolean {
  const code = (row.code ?? "").trim();
  const label = (row.label ?? "").trim().toLowerCase();
  if (code === "Ialt" || code === "999") return true;
  if (label.startsWith("alder i alt")) return true;
  if (label === "i alt") return true;
  return false;
}

function highestMedian(series: SalarySeriesRow[]): SalarySeriesRow | null {
  let best: SalarySeriesRow | null = null;
  for (const r of series) {
    if (isAllRow(r)) continue;
    if (r.median_salary == null) continue;
    if (!best || (best.median_salary ?? 0) < (r.median_salary ?? 0)) best = r;
  }
  return best;
}

// ============================================================
// SalaryProfileSection
// ============================================================

export type SalaryProfileSectionProps = {
  industrySlug: string | null;
  industryName: string | null;
  source: SalaryIndustrySource;
  variant?: "standalone" | "embedded";
  /** Overstyrer intern tittel i embedded-variant. */
  embeddedTitle?: string;
  /** Overstyrer intern forklaring i embedded-variant. */
  embeddedExplanation?: string;
};

export function SalaryProfileSection({
  industrySlug,
  industryName,
  source,
  variant = "standalone",
  embeddedTitle,
  embeddedExplanation,
}: SalaryProfileSectionProps) {
  const [eduLevel, setEduLevel] = useState<string>("__all");
  const [ageGroup, setAgeGroup] = useState<string>("__all");
  const [gender, setGender] = useState<string>("0");
  const [sector, setSector] = useState<string>("ALLE");
  const [workingTime, setWorkingTime] = useState<string>("0");

  const eduParam = eduLevel === "__all" ? null : eduLevel;
  const ageParam = ageGroup === "__all" ? null : ageGroup;

  // Guard: industrySlug må være en faktisk slug, ikke et visningsnavn.
  // Slug har små bokstaver med _ eller - som separator — aldri mellomrom.
  const slugLooksInvalid =
    !!industrySlug &&
    (industrySlug.includes(" ") || /[A-ZÆØÅ]/.test(industrySlug));

  if (slugLooksInvalid) {
    // eslint-disable-next-line no-console
    console.error("Invalid salary industry slug", {
      industrySlug,
      industryName,
      source,
    });
  }

  const slugForRpc = industrySlug && !slugLooksInvalid ? industrySlug : null;

  const query = useQuery({
    enabled: !!slugForRpc,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 10 * 60 * 1000,
    queryKey: [
      "salary-profile",
      slugForRpc,
      eduParam,
      ageParam,
      gender,
      sector,
      workingTime,
    ],
    queryFn: async (): Promise<SalaryProfilePayload> => {
      const { data, error } = await supabase.rpc("get_public_salary_profile", {
        filter_industry_slug: slugForRpc,
        filter_nace_code: null,
        education_level: eduParam,
        age_group: ageParam,
        gender,
        sector,
        working_time: workingTime,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("get_public_salary_profile error", {
          error,
          industrySlug: slugForRpc,
          industryName,
          source,
          education_level: eduParam,
          age_group: ageParam,
          gender,
          sector,
          working_time: workingTime,
        });
        throw new Error(error.message);
      }
      return (data ?? {}) as SalaryProfilePayload;
    },
  });

  const payload = query.data;
  const eduSeries = payload?.education_series ?? [];
  const ageSeries = payload?.age_series ?? [];
  const kpis = payload?.kpis ?? {};
  const noData =
    !!payload &&
    (payload.found === false ||
      (eduSeries.length === 0 && ageSeries.length === 0));

  const displayName = industryName ?? "valgt næring";

  // ----- Tekst etter kontekst -----
  const { title, explanation, ctaText } = useMemo(() => {
    // Embedded-variant kan overstyre tittel/forklaring (brukes på yrkesdetalj).
    if (variant === "embedded" && (embeddedTitle || embeddedExplanation)) {
      let exp = embeddedExplanation ?? null;
      if (!exp) {
        if (source === "filter") {
          exp = `Tallene under viser offisielle SSB-tall for ${displayName}, siden du har valgt denne bransjen.`;
        } else if (source === "fallback") {
          exp = `SSB publiserer disse lønnstallene etter næring, ikke direkte etter ESCO-stilling. Derfor viser vi næringen som ligger nærmest denne stillingen: ${displayName}.`;
        }
      }
      return {
        title: embeddedTitle ?? "Lønnsvariasjon etter utdanning og alder",
        explanation: exp,
        ctaText: null as string | null,
      };
    }
    if (source === "filter") {
      return {
        title: "Lønn i valgt bransje",
        explanation: `Offisielle SSB-tall for median månedslønn i ${displayName}.`,
        ctaText: null as string | null,
      };
    }
    if (source === "fallback") {
      return {
        title: "Lønn i relevant næring",
        explanation: `SSB publiserer lønn etter næring, ikke direkte etter ESCO-stilling. Derfor viser vi næringen som ligger nærmest denne stillingen: ${displayName}.`,
        ctaText: null,
      };
    }
    return {
      title: "Lønn i relevant næring",
      explanation: null,
      ctaText: "Velg en bransje for å se lønn etter utdanningsnivå og alder.",
    };
  }, [source, displayName, variant, embeddedTitle, embeddedExplanation]);

  // ----- Method notes -----
  const methodNotes: string[] = useMemo(() => {
    const raw = payload?.method_notes;
    const list: string[] = Array.isArray(raw)
      ? raw.filter((n): n is string => typeof n === "string" && n.length > 0)
      : typeof raw === "string" && raw.trim().length > 0
        ? [raw]
        : [];
    const hasSsbNote = list.some(
      (n) =>
        n.toLowerCase().includes("alder") &&
        n.toLowerCase().includes("utdanning"),
    );
    return hasSsbNote ? list : [...list, SALARY_METHOD_FALLBACK];
  }, [payload?.method_notes]);

  // ----- Embedded "none" rendrer ingenting -----
  if (variant === "embedded" && source === "none") {
    return null;
  }

  // ----- Inner content -----
  const inner = (
    <>
      {variant === "standalone" ? (
        <SectionHead title={title} subtitle={explanation ?? undefined} />
      ) : (
        <EmbeddedHead title={title} subtitle={explanation ?? undefined} />
      )}

      {source === "none" && ctaText && (
        <p className="mt-4 text-sm text-[var(--km-ink-soft)]">{ctaText}</p>
      )}

      {slugForRpc && (
        <p className="mt-3 text-xs text-[var(--km-ink-soft)]">
          Tallene er nasjonale for valgt næring. Region brukes ikke i disse
          SSB-tabellene.
        </p>
      )}

      {slugLooksInvalid && (
        <EmptyState text="Vi har ikke nok SSB-data til å vise lønnsprofil for dette utvalget." />
      )}

      {slugForRpc && query.isLoading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--km-ink-soft)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter lønnsprofil …
        </div>
      )}

      {slugForRpc && !query.isLoading && query.error && (
        <EmptyState text="Vi klarte ikke å hente lønnsprofil akkurat nå." />
      )}

      {slugForRpc && !query.isLoading && !query.error && noData && (
        <EmptyState text="Vi har ikke nok SSB-data til å vise lønnsprofil for dette utvalget." />
      )}


      {slugForRpc && !query.isLoading && !query.error && !noData && payload && (
        <div className="mt-4 space-y-6">
          {/* KPI-rad */}
          <SalaryKpiRow
            industryName={displayName}
            industryKpi={kpis.industry_median ?? null}
            eduSelected={!!eduParam}
            ageSelected={!!ageParam}
            eduKpi={kpis.education_median ?? null}
            ageKpi={kpis.age_median ?? null}
            eduSeries={eduSeries}
            ageSeries={ageSeries}
          />

          {eduSeries.length > 0 && <SalaryEducationChart series={eduSeries} />}
          {ageSeries.length > 0 && <SalaryAgeChart series={ageSeries} />}

          {/* Tilpass visningen */}
          <div className="border-t border-rule pt-4">
            <h4 className="text-sm font-semibold text-[var(--km-ink)]">
              Tilpass visningen
            </h4>
            <p className="mt-1 text-xs text-[var(--km-ink-soft)]">
              Endre utvalg for å se hvordan median månedslønn varierer.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <SalaryFilterSelect
                label="Utdanningsnivå"
                value={eduLevel}
                onChange={setEduLevel}
                options={SALARY_EDU_OPTIONS}
              />
              <SalaryFilterSelect
                label="Aldersgruppe"
                value={ageGroup}
                onChange={setAgeGroup}
                options={SALARY_AGE_OPTIONS}
              />
              <SalaryFilterSelect
                label="Kjønn"
                value={gender}
                onChange={setGender}
                options={SALARY_GENDER_OPTIONS}
              />
              <SalaryFilterSelect
                label="Sektor"
                value={sector}
                onChange={setSector}
                options={SALARY_SECTOR_OPTIONS}
              />
              <SalaryFilterSelect
                label="Arbeidstid"
                value={workingTime}
                onChange={setWorkingTime}
                options={SALARY_WORKING_TIME_OPTIONS}
              />
            </div>
          </div>

          <div className="border-t border-rule pt-3 text-xs text-[var(--km-ink-soft)] leading-snug">
            {methodNotes.map((n, i) => (
              <p key={i} className={i > 0 ? "mt-1.5" : undefined}>
                {n}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  );

  if (variant === "embedded") {
    return (
      <div id="lonn" className="mt-5 border-t border-rule pt-5 scroll-mt-24">
        {inner}
      </div>
    );
  }
  return (
    <section id="lonn" className={cn(SECTION_CARD, "scroll-mt-24")}>
      {inner}
    </section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SectionHead({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h3 className="text-base md:text-lg font-semibold flex items-center gap-2 text-[var(--km-ink)]">
        <span className="text-[var(--km-ink-soft)]">
          <Wallet className="h-4 w-4" />
        </span>
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-[var(--km-ink-soft)] mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function EmbeddedHead({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h3 className="text-sm md:text-base font-semibold flex items-center gap-2 text-[var(--km-ink)]">
        <span className="text-[var(--km-ink-soft)]">
          <Wallet className="h-4 w-4" />
        </span>
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-[var(--km-ink-soft)] mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2 border border-dashed border-rule bg-[var(--km-paper-warm)] px-3 py-3 text-xs text-[var(--km-ink-soft)]">
      {text}
    </div>
  );
}

function SalaryKpiRow({
  industryName,
  industryKpi,
  eduSelected,
  ageSelected,
  eduKpi,
  ageKpi,
  eduSeries,
  ageSeries,
}: {
  industryName: string;
  industryKpi: SalaryKpi | null;
  eduSelected: boolean;
  ageSelected: boolean;
  eduKpi: SalaryKpi | null;
  ageKpi: SalaryKpi | null;
  eduSeries: SalarySeriesRow[];
  ageSeries: SalarySeriesRow[];
}) {
  const eduInsight = useMemo(() => highestMedian(eduSeries), [eduSeries]);
  const ageInsight = useMemo(() => highestMedian(ageSeries), [ageSeries]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <SalaryKpiCard
        label={`Median i ${industryName}`}
        kpi={industryKpi}
      />
      {eduSelected ? (
        <SalaryKpiCard label="Valgt utdanningsnivå" kpi={eduKpi} />
      ) : eduInsight ? (
        <SalaryInsightCard
          label="Høyest median etter utdanning"
          rowLabel={eduInsight.label}
          row={eduInsight}
        />
      ) : (
        <SalaryKpiCard label="Høyest median etter utdanning" kpi={null} />
      )}
      {ageSelected ? (
        <SalaryKpiCard label="Valgt aldersgruppe" kpi={ageKpi} />
      ) : ageInsight ? (
        <SalaryInsightCard
          label="Høyest median etter alder"
          rowLabel={ageInsight.label}
          row={ageInsight}
        />
      ) : (
        <SalaryKpiCard label="Høyest median etter alder" kpi={null} />
      )}
    </div>
  );
}

function SalaryKpiCard({
  label,
  kpi,
}: {
  label: string;
  kpi?: SalaryKpi | null;
}) {
  const median = kpi?.median_salary ?? null;
  const range = formatQuartileRange(
    kpi?.lower_quartile_salary,
    kpi?.upper_quartile_salary,
  );
  const basis = formatEmploymentBasis(kpi?.employment_count);
  return (
    <div className="border border-rule rounded-2 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--km-ink-soft)] font-mono">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--km-ink)]">
        {formatKrPerMonth(median)}
      </div>
      {range && (
        <div className="mt-1 text-xs text-[var(--km-ink-soft)]">{range}</div>
      )}
      {basis && (
        <div className="mt-0.5 text-[11px] text-[var(--km-ink-soft)] font-mono">
          {basis}
        </div>
      )}
    </div>
  );
}

function SalaryInsightCard({
  label,
  rowLabel,
  row,
}: {
  label: string;
  rowLabel: string;
  row: SalarySeriesRow;
}) {
  const range = formatQuartileRange(
    row.lower_quartile_salary,
    row.upper_quartile_salary,
  );
  const basis = formatEmploymentBasis(row.employment_count);
  return (
    <div className="border border-rule rounded-2 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--km-ink-soft)] font-mono">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--km-ink-soft)]">
        {rowLabel}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--km-ink)]">
        {formatKrPerMonth(row.median_salary)}
      </div>
      {range && (
        <div className="mt-1 text-xs text-[var(--km-ink-soft)]">{range}</div>
      )}
      {basis && (
        <div className="mt-0.5 text-[11px] text-[var(--km-ink-soft)] font-mono">
          {basis}
        </div>
      )}
    </div>
  );
}

function SalaryFilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--km-ink-soft)]">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function SalaryChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SalarySeriesRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const range = formatQuartileRange(
    row.lower_quartile_salary,
    row.upper_quartile_salary,
  );
  const basis = formatEmploymentBasis(row.employment_count);
  return (
    <div className="rounded-2 border border-rule bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-[var(--km-ink)]">{row.label}</div>
      <div className="mt-1 text-[var(--km-ink)]">
        Median: {formatKrPerMonth(row.median_salary)}
      </div>
      {range && (
        <div className="mt-0.5 text-[var(--km-ink-soft)]">{range}</div>
      )}
      {basis && (
        <div className="mt-0.5 text-[var(--km-ink-soft)]">{basis}</div>
      )}
    </div>
  );
}

function SalaryEducationChart({ series }: { series: SalarySeriesRow[] }) {
  const data = series.map((r) => ({ ...r, median: r.median_salary ?? 0 }));
  const ink = "var(--km-ink)";
  const accent = "var(--km-accent, #3A6CB0)";
  const height = Math.max(180, data.length * 44 + 40);
  return (
    <div>
      <h4 className="text-sm font-semibold text-[var(--km-ink)]">
        Lønn etter utdanningsnivå
      </h4>
      <p className="mt-1 text-xs text-[var(--km-ink-soft)]">
        Median månedslønn i valgt næring per utdanningsnivå.
      </p>
      <div className="mt-3" style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--km-rule, #E6E2DB)" />
            <XAxis
              type="number"
              tickFormatter={(v) => new Intl.NumberFormat("nb-NO").format(v)}
              tick={{ fontSize: 11, fill: "var(--km-ink-soft)" }}
              axisLine={{ stroke: "var(--km-rule, #E6E2DB)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={200}
              tick={{ fontSize: 12, fill: "var(--km-ink)" }}
              axisLine={false}
              tickLine={false}
            />
            <RTooltip
              content={<SalaryChartTooltip />}
              cursor={{ fill: "var(--km-paper-warm, #F2EFEA)" }}
            />
            <Bar dataKey="median" radius={[0, 4, 4, 0]}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.is_selected ? accent : ink} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SalaryAgeChart({ series }: { series: SalarySeriesRow[] }) {
  const data = series.map((r) => ({ ...r, median: r.median_salary ?? 0 }));
  const ink = "var(--km-ink)";
  const accent = "var(--km-accent, #3A6CB0)";
  const selected = data.find((d) => d.is_selected);
  return (
    <div>
      <h4 className="text-sm font-semibold text-[var(--km-ink)]">
        Lønn etter alder
      </h4>
      <p className="mt-1 text-xs text-[var(--km-ink-soft)]">
        Median månedslønn i valgt næring per aldersgruppe.
      </p>
      <div className="mt-3" style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke="var(--km-rule, #E6E2DB)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--km-ink-soft)" }}
              axisLine={{ stroke: "var(--km-rule, #E6E2DB)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => new Intl.NumberFormat("nb-NO").format(v)}
              tick={{ fontSize: 11, fill: "var(--km-ink-soft)" }}
              axisLine={false}
              tickLine={false}
              width={70}
            />
            <RTooltip content={<SalaryChartTooltip />} />
            {selected && (
              <ReferenceLine
                x={selected.label}
                stroke={accent}
                strokeDasharray="3 3"
              />
            )}
            <Line
              type="monotone"
              dataKey="median"
              stroke={ink}
              strokeWidth={2}
              dot={(props: any) => {
                const row: SalarySeriesRow = props.payload;
                const r = row.is_selected ? 5 : 3;
                return (
                  <circle
                    key={`dot-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={r}
                    fill={row.is_selected ? accent : ink}
                    stroke="white"
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
