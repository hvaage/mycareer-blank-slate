import { Link } from "@tanstack/react-router";
import type { ReportRow } from "@/lib/reports.functions";
import { ScoreBadge } from "./ScoreBadge";
import { DimensionMiniBars } from "./DimensionMiniBars";

type Props = {
  latest: ReportRow;
  reportCount: number;
};

function faviconFor(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function ReportCard({ latest, reportCount }: Props) {
  const dims = latest.dimensions ?? [];
  return (
    <Link
      to="/selskapsanalyse/analysedatabase/$id"
      params={{ id: latest.id }}
      className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <img
          src={faviconFor(latest.company_domain)}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-foreground group-hover:text-primary">
            {latest.company_name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {latest.company_domain}
            {latest.branch_country ? ` · ${latest.branch_country}` : ""}
          </p>
        </div>
        <ScoreBadge score={latest.overall_score} size="lg" />
      </div>

      <div className="mt-4">
        <DimensionMiniBars dimensions={dims} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">
          {(latest.scored_dimensions ?? 0)}/{latest.total_dimensions ?? 8} dimensjoner
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 uppercase">
          {latest.tier}
        </span>
        {latest.employee_count != null && (
          <span className="rounded-full bg-muted px-2 py-0.5">
            ~ {latest.employee_count.toLocaleString("nb-NO")} ansatte
          </span>
        )}
        {reportCount > 1 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            {reportCount} rapporter
          </span>
        )}
      </div>
    </Link>
  );
}
