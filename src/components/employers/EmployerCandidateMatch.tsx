/**
 * Personlig kandidatmatch for innlogget visning av arbeidsgiveranalysen.
 *
 * Egen komponent (K6) som:
 * - viser «Kandidatmatch (deg)»
 * - bevarer eksisterende unavailable/partial/rated-tilstander
 * - validerer at ai_candidate_scenario_notes faktisk er et array
 * - viser notatene som en vanlig punktliste — aldri rå JSON
 *
 * `hasAnalysis` lar oss skille mellom:
 * - V2-selskapsanalyse mangler  →  «Kandidatmatch beregnes når selskapsanalysen er på plass»
 * - V2 finnes, men kandidatmatch mangler  →  «Vi har ikke regnet ut din match ennå»
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  candidateFitUiState,
  displayCandidateFitReasoning,
  type UserRatingRow,
} from "@/lib/queries/companies";

const nbScoreOne = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtScore(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${nbScoreOne.format(n)} / 5,0`;
}

export function EmployerCandidateMatch({
  myRating,
  hasAnalysis,
}: {
  myRating: UserRatingRow | null;
  hasAnalysis: boolean;
}) {
  const state = candidateFitUiState(myRating);

  if (!hasAnalysis) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Kandidatmatch beregnes når selskapsanalysen er på plass.
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm space-y-2">
        <p className="font-medium text-amber-900 dark:text-amber-100">
          Kandidatmatch (deg) — kan ikke vurderes
        </p>
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-2 prose-ul:my-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayCandidateFitReasoning(
              myRating?.ai_candidate_fit_reasoning ?? "",
            )}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (state === "partial") {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-sm space-y-2">
        <p className="font-medium">
          Kandidatmatch (deg) — ikke fullført som tall-score
        </p>
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayCandidateFitReasoning(
              myRating?.ai_candidate_fit_reasoning ?? "",
            )}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (state === "rated" && myRating) {
    const notesRaw = (myRating as { ai_candidate_scenario_notes?: unknown })
      .ai_candidate_scenario_notes;
    const scenarioNotes = Array.isArray(notesRaw)
      ? notesRaw.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : [];
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Kandidatmatch (deg)
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {fmtScore(myRating.ai_candidate_fit_score)}
          </div>
        </div>
        {myRating.ai_candidate_fit_reasoning ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Begrunnelse
            </h4>
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-2 prose-li:my-0.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayCandidateFitReasoning(myRating.ai_candidate_fit_reasoning)}
              </ReactMarkdown>
            </div>
          </div>
        ) : null}
        {scenarioNotes.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Scenarienotater for deg
            </h4>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {scenarioNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  // state === "none" — V2 finnes, men ingen kandidatmatch lagret enda.
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
      Vi har ikke regnet ut din personlige match for dette selskapet ennå.
    </div>
  );
}
