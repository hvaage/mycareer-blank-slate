import { Link } from "@tanstack/react-router";
import { Search, Globe } from "lucide-react";

const DIMS: Array<{ key: string; label: string }> = [
  { key: "ai_culture_score", label: "Kultur" },
  { key: "ai_leadership_score", label: "Ledelse" },
  { key: "ai_work_environment_score", label: "Arbeidsmiljø" },
  { key: "ai_career_development_score", label: "Karriere" },
  { key: "ai_financial_stability_score", label: "Økonomi" },
  { key: "ai_mission_score", label: "Formål" },
];

function fmtScore(v: any): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function uniqueDomains(urls: string[], max = 4): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const host = new URL(u.startsWith("http") ? u : `https://${u}`)
        .hostname.replace(/^www\./, "");
      if (!out.includes(host)) out.push(host);
      if (out.length >= max) break;
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function CompanyAnalysisCard({
  company,
  candidateFitScore = null,
  candidateFitReasoning = null,
}: {
  company: any;
  candidateFitScore?: number | null;
  candidateFitReasoning?: string | null;
}) {
  const log = Array.isArray(company.research_log) ? company.research_log : [];
  let sources: string[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (Array.isArray(log[i]?.sources) && log[i].sources.length) {
      sources = log[i].sources;
      break;
    }
  }
  const domains = uniqueDomains(sources);
  const hasAi = company.ai_rated_at != null;

  return (
    <Link
      to="/employers/$companyId"
      params={{ companyId: company.id }}
      className="block rounded-xl border bg-card p-4 sm:p-5 hover:shadow-md hover:border-primary/40 transition-all"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          <span>Selskapsanalyse</span>
        </div>
        {candidateFitScore != null && (
          <span className="rounded-full bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1">
            Kandidatmatch {fmtScore(candidateFitScore)} / 5
          </span>
        )}
      </div>
      <h3 className="text-lg sm:text-xl font-bold tracking-tight mb-3">
        {company.name}
      </h3>

      {hasAi ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {DIMS.map((d) => (
            <div
              key={d.key}
              className="flex items-center justify-between rounded-full border bg-background/60 px-3 py-1.5 sm:px-4 sm:py-2"
            >
              <span className="text-sm text-muted-foreground">{d.label}</span>
              <span className="text-sm font-bold tabular-nums">
                {fmtScore((company as any)[d.key])}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Ikke analysert ennå — åpne selskapsprofilen for å starte AI-analyse.
        </p>
      )}

      {candidateFitReasoning && (
        <p className="text-xs text-muted-foreground mt-3 line-clamp-2">
          <span className="font-medium text-foreground">Match: </span>
          {candidateFitReasoning}
        </p>
      )}

      {domains.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 pt-3 border-t">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Kilder: {domains.join(", ")}</span>
        </div>
      )}
    </Link>
  );
}
