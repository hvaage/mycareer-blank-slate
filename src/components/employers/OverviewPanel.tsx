import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile, fmtNumber, fmtNok, fmtPercent, fmtRatio } from "./MetricTile";

export function OverviewPanel({ d }: { d: EmployerDetail }) {
  const aar = d.regnskapsaar ?? null;
  return (
    <div className="space-y-3">
      {aar !== null && (
        <p className="text-xs text-muted-foreground">
          Tall fra regnskapsåret <span className="tabular-nums">{aar}</span>.
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile label="Ansatte" value={fmtNumber(d.antall_ansatte)} hint={d.ansatte_bucket ?? undefined} />
        <MetricTile label="Omsetning" value={fmtNok(d.driftsinntekter)} hint={d.omsetning_bucket ?? undefined} />
        <MetricTile label="Driftsresultat" value={fmtNok(d.driftsresultat)} />
        <MetricTile label="Årsresultat" value={fmtNok(d.aarsresultat)} />
        <MetricTile label="Driftsmargin" value={fmtPercent(d.driftsmargin_prosent)} />
        <MetricTile label="EK-andel" value={fmtPercent(d.egenkapitalandel_prosent)} />
        <MetricTile label="Gjeldsgrad" value={fmtRatio(d.gjeldsgrad)} />
        <MetricTile
          label="Selskapsalder"
          value={selskapsalder(d.stiftelsesdato, d.selskapsalder_aar)}
          hint={d.stiftelsesdato ?? undefined}
        />
      </div>
    </div>
  );
}

function selskapsalder(
  dato: string | null | undefined,
  aar: number | null | undefined,
): string | null {
  if (typeof aar === "number") return `${aar} år`;
  if (!dato) return null;
  const d = new Date(dato);
  if (Number.isNaN(d.getTime())) return null;
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${years} år`;
}

