import { useMemo } from "react";
import type { EmployerSearchRow } from "@/lib/queries/employer-insight";
import { ARBEIDSGIVER_TYPER } from "@/lib/employers/no-regions";
import { fmtNumber, fmtNok } from "./MetricTile";
import {
  ANSATTE_KATEGORI_LABEL,
  ANSATTE_KATEGORI_REKKEFOELGE,
  ANSATTE_KILDEFORKLARING,
  ansatteKategori,
  fordelingFraRader,
  formatAnsatte,
} from "@/lib/employers/ansatte";

/**
 * Client-side aggregater over kun de paginerte radene. Tydelig merket
 * "Basert på viste treff" — ingen full markedsstatistikk her.
 */
export function SelectionInsights({
  rows,
  page,
  pageSize,
  hasAnyFilter,
}: {
  rows: EmployerSearchRow[];
  page: number;
  pageSize: number;
  hasAnyFilter: boolean;
}) {
  const buckets = useMemo(() => computeBuckets(rows), [rows]);
  const ansatteFordeling = useMemo(() => fordelingFraRader(rows), [rows]);
  if (!hasAnyFilter || rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Utvalgsinnsikt</h2>
        <p className="text-xs text-muted-foreground">
          Basert på viste treff (side {page}, {rows.length} rader).
          Markedsdekkende statistikk kommer når summary-RPC er på plass.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <DistributionCard
          title="Arbeidsgivertype"
          entries={buckets.type}
          formatLabel={(v) =>
            ARBEIDSGIVER_TYPER.find((t) => t.value === v)?.label ?? humanize(v)
          }
        />
        <DistributionCard
          title="Ansatte (viste treff)"
          entries={ANSATTE_KATEGORI_REKKEFOELGE.map((k) => [
            ANSATTE_KATEGORI_LABEL[k],
            ansatteFordeling[k],
          ])}
          footnote={ANSATTE_KILDEFORKLARING}
          alwaysShowAll
        />
        <DistributionCard title="Omsetningsbucket" entries={buckets.omsetning} />
        <TopList
          title="Toppliste — flest ansatte (viste treff)"
          footnote={`Kun de ${fmtNumber(ansatteFordeling.fem_eller_flere) ?? "0"} radene med fem eller flere ansatte kan rangeres. ${fmtNumber(ansatteFordeling.null_til_fire) ?? "0"} har null til fire, ${fmtNumber(ansatteFordeling.ukjent) ?? "0"} er ukjent.`}
          items={[...rows]
            .filter((r) => ansatteKategori(r) === "fem_eller_flere")
            .sort((a, b) => (b.antall_ansatte ?? 0) - (a.antall_ansatte ?? 0))
            .slice(0, 5)
            .map((r) => ({
              key: r.organisasjonsnummer,
              label: r.navn,
              value: formatAnsatte(r),
            }))}
        />
        <TopList
          title="Toppliste — høyest omsetning (viste treff)"
          items={[...rows]
            .filter((r) => typeof r.driftsinntekter === "number")
            .sort((a, b) => (b.driftsinntekter ?? 0) - (a.driftsinntekter ?? 0))
            .slice(0, 5)
            .map((r) => ({
              key: r.organisasjonsnummer,
              label: r.navn,
              value: fmtNok(r.driftsinntekter) ?? "—",
            }))}
        />
        <FlagList
          title="Rader med risiko- eller datakvalitetsflagg"
          items={rows
            .filter((r) => (r.risiko_flags?.length ?? 0) + (r.datakvalitet_flags?.length ?? 0) > 0)
            .slice(0, 8)
            .map((r) => ({
              key: r.organisasjonsnummer,
              label: r.navn,
              flags: [
                ...(r.risiko_flags ?? []).map((f) => `⚠ ${humanize(f)}`),
                ...(r.datakvalitet_flags ?? []).map((f) => `· ${humanize(f)}`),
              ],
            }))}
        />
      </div>

      {/* TODO: Når public.employer_selection_summary RPC finnes, hentes
          markedsdekkende median/snitt/regnskapsdekning og settes inn her i
          stedet for client-side aggregater. */}
    </section>
  );
}

type BucketSet = {
  type: Array<[string, number]>;
  omsetning: Array<[string, number]>;
};

function computeBuckets(rows: EmployerSearchRow[]): BucketSet {
  const tally = (key: keyof EmployerSearchRow): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const v = r[key];
      if (typeof v !== "string" || v === "") continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const sort = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    type: sort(tally("arbeidsgiver_type")),
    omsetning: sort(tally("omsetning_bucket")),
  };
}

function DistributionCard({
  title,
  entries,
  formatLabel,
  footnote,
  alwaysShowAll,
}: {
  title: string;
  entries: Array<[string, number]>;
  formatLabel?: (v: string) => string;
  footnote?: string;
  alwaysShowAll?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">Ingen data i viste treff.</div>
      </div>
    );
  }
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-2 space-y-1">
        {(alwaysShowAll ? entries : entries.slice(0, 6)).map(([k, n]) => (
          <li key={k} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-foreground">
              {formatLabel ? formatLabel(k) : humanize(k)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {n} ({total > 0 ? Math.round((n / total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
      {footnote ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}

function TopList({
  title,
  items,
  footnote,
}: {
  title: string;
  items: Array<{ key: string; label: string; value: string }>;
  footnote?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">Ingen data i viste treff.</div>
        {footnote ? (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{footnote}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ol className="mt-2 space-y-1">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-foreground">{it.label}</span>
            <span className="tabular-nums text-muted-foreground">{it.value}</span>
          </li>
        ))}
      </ol>
      {footnote ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}

function FlagList({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; flags: string[] }>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">Ingen flaggede rader i viste treff.</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.key} className="text-sm">
            <div className="truncate font-medium text-foreground">{it.label}</div>
            <div className="text-xs text-muted-foreground">{it.flags.join(" · ")}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
