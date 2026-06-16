import type { EmployerDetail } from "@/lib/queries/employer-insight";
import { MetricTile } from "./MetricTile";

const DIM: Array<{ key: keyof EmployerDetail; label: string }> = [
  { key: "ai_culture_score", label: "Kultur" },
  { key: "ai_leadership_score", label: "Ledelse" },
  { key: "ai_work_environment_score", label: "Arbeidsmiljø" },
  { key: "ai_career_development_score", label: "Karriere" },
  { key: "ai_financial_stability_score", label: "Finansiell stabilitet" },
  { key: "ai_mission_score", label: "Formål" },
];

/**
 * Eksisterende AI-vurdering (6 dimensjoner). Ikke samme som extended 8-dim.
 */
export function SixDimensionAiPanel({ d }: { d: EmployerDetail }) {
  const harData =
    typeof d.ai_overall_score === "number" ||
    DIM.some((x) => typeof d[x.key] === "number");

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Dette er den eksisterende AI-vurderingen med 6 dimensjoner.
        <strong className="text-foreground"> Ikke det samme</strong> som extended-arbeidsgiveranalysen med 8 dimensjoner.
      </div>

      {!harData ? (
        <p className="text-sm text-muted-foreground">
          Ingen AI-vurdering generert for denne arbeidsgiveren ennå.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricTile
              label="Totalscore"
              value={fmtScore(d.ai_overall_score)}
              hint="Skala 1,0–5,0"
            />
            {DIM.map((x) => (
              <MetricTile key={x.key} label={x.label} value={fmtScore(d[x.key] as number | null | undefined)} />
            ))}
          </div>
          {typeof d.ai_dimension_notes === "string" && d.ai_dimension_notes && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{d.ai_dimension_notes}</p>
          )}
          {d.ai_rating_notes && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{d.ai_rating_notes}</p>
          )}
        </>
      )}
    </div>
  );
}

function fmtScore(n: number | null | undefined): string | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return n.toFixed(1).replace(".", ",");
}
