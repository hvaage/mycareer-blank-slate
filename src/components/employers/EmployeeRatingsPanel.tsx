import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile } from "./MetricTile";
import { LoginCta } from "./LoginCta";

const DIM: Array<{ key: keyof EmployerDetail; label: string }> = [
  { key: "agg_culture_score", label: "Kultur" },
  { key: "agg_leadership_score", label: "Ledelse" },
  { key: "agg_work_environment_score", label: "Arbeidsmiljø" },
  { key: "agg_career_development_score", label: "Karriere" },
  { key: "agg_financial_stability_score", label: "Finansiell stabilitet" },
  { key: "agg_mission_score", label: "Formål" },
];

export function EmployeeRatingsPanel({ d, orgnr }: { d: EmployerDetail; orgnr: string }) {
  const count = d.agg_rating_count ?? 0;
  if (!count || count <= 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ingen ansattvurderinger ennå for denne arbeidsgiveren.
        </p>
        <LoginCta label="Logg inn for å vurdere" redirectTo={`/arbeidsgivere/${orgnr}`} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Basert på <span className="tabular-nums">{count}</span> vurdering{count === 1 ? "" : "er"}.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile label="Snittscore" value={fmtScore(d.agg_overall_score)} hint="Skala 1,0–5,0" />
        {DIM.map((x) => (
          <MetricTile key={x.key} label={x.label} value={fmtScore(d[x.key] as number | null | undefined)} />
        ))}
      </div>
      <div>
        <LoginCta label="Logg inn for å vurdere" redirectTo={`/arbeidsgivere/${orgnr}`} />
      </div>
    </div>
  );
}

function fmtScore(n: number | null | undefined): string | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return n.toFixed(1).replace(".", ",");
}
