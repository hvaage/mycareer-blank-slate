import type { DimensionEntry } from "@/lib/reports.functions";

type Props = {
  dimensions: DimensionEntry[];
};

function barColor(score: number | null) {
  if (score == null) return "bg-muted";
  if (score >= 4.0) return "bg-emerald-500";
  if (score >= 3.0) return "bg-amber-500";
  return "bg-rose-500";
}

export function DimensionMiniBars({ dimensions }: Props) {
  return (
    <div className="grid grid-cols-8 gap-1" aria-label="Score per dimensjon">
      {dimensions.map((d, i) => {
        const pct = d.score == null ? 100 : (d.score / 5) * 100;
        return (
          <div
            key={`${d.name}-${i}`}
            className="flex flex-col items-center gap-1"
            title={`${d.name}: ${d.score == null ? "Ikke nok data" : d.score.toFixed(1)}`}
          >
            <div className="relative h-10 w-full overflow-hidden rounded bg-muted/40">
              <div
                className={`absolute bottom-0 left-0 right-0 ${barColor(d.score)} ${d.score == null ? "opacity-40" : ""}`}
                style={{ height: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
