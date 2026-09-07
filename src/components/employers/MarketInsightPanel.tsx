/**
 * Kompakt «Markedsinnsikt»-panel.
 *
 * Viser Universum-plassering for én arbeidsgiver — men kun når backend har
 * returnert et entydig, kildebelagt registertreff. Er `market_insights.universum`
 * fraværende (ukjent eller tvetydig navn), rendres ingenting.
 *
 * Dette er studentpreferanse, ikke en kvalitetsvurdering av arbeidsgiveren.
 */
import { ExternalLink, TrendingDown, TrendingUp, Minus, Sparkles } from "lucide-react";
import type { UniversumMarketInsight } from "@/lib/queries/employer-analysis-view";

function formatDato(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "long", year: "numeric" });
}

function trendTekst(u: UniversumMarketInsight): { label: string; Icon: typeof TrendingUp } | null {
  const fra = u.previous_rank ? ` (fra #${u.previous_rank})` : "";
  switch (u.trend_from_2025) {
    case "up":
      return { label: `Opp fra 2025${fra}`, Icon: TrendingUp };
    case "down":
      return { label: `Ned fra 2025${fra}`, Icon: TrendingDown };
    case "unchanged":
      return { label: "Uendret fra 2025", Icon: Minus };
    case "new":
      return { label: "Ny på listen i 2026", Icon: Sparkles };
    default:
      return null;
  }
}

export function MarketInsightPanel({
  universum,
  className,
}: {
  universum: UniversumMarketInsight | null | undefined;
  className?: string;
}) {
  if (!universum || typeof universum.rank !== "number") return null;

  const trend = trendTekst(universum);
  const hentet = formatDato(universum.fetched_at);

  return (
    <section className={className}>
      <h3 className="mb-2 text-sm font-semibold text-foreground">Markedsinnsikt</h3>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">
          Universum {universum.year}: #{universum.rank} blant IT-studenter i Norge
        </p>

        {trend ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <trend.Icon className="h-4 w-4" aria-hidden />
            {trend.label}
          </p>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Dette måler hvor attraktiv arbeidsgiveren er blant IT-studenter. Det er en
          preferansemåling, ikke en kvalitetsvurdering av arbeidsgiveren.
        </p>

        <p className="mt-2 text-xs text-muted-foreground">
          Kilde:{" "}
          {universum.source_url ? (
            <a
              href={universum.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
            >
              {universum.source_name ?? "Universum"}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : (
            (universum.source_name ?? "Universum")
          )}
          {hentet ? ` · hentet ${hentet}` : null}
          {universum.total_ranked ? ` · ${universum.total_ranked} rangerte arbeidsgivere` : null}
        </p>
      </div>
    </section>
  );
}
