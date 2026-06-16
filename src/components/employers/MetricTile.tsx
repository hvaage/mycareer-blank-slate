export function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
}) {
  const display = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground min-w-[3ch]">
        {display}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function fmtNumber(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return new Intl.NumberFormat("nb-NO").format(n);
}

export function fmtNok(n: number | null | undefined): string | null {
  const s = fmtNumber(n);
  return s ? `${s} kr` : null;
}

export function fmtPercent(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(n)} %`;
}

export function fmtRatio(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(n)}x`;
}
