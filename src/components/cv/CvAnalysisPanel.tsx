/**
 * KI-analyse av funn fra én CV-import.
 *
 * Flyt: brukeren retter parsefeil først, starter så analysen. Utvalget deles
 * i delbatcher som kjøres én om gangen med samlet fremdrift. Resultatet er
 * forslag som må godkjennes manuelt — ingenting lagres i karriereoversikten
 * automatisk.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  atomEnrichmentProposalsByImportQuery,
  invalidateAtomEnrichmentQueries,
  approveAtomEnrichmentProposal,
  rejectAtomEnrichmentProposal,
  markAtomEnrichmentProposalNeedsContext,
  TARGET_ATOM_TYPE_LABELS,
  type AtomEnrichmentProposalRow,
} from "@/lib/queries/atom-enrichment";
import {
  planAnalysisChunks,
  selectionTooLarge,
  type AnalysisCandidate,
} from "@/lib/cv-atom-analysis";
import {
  jobProgressPercent,
  followAtomizationJob,
  startAtomizationJob,
  type JobBlockProgress,
} from "@/lib/cv-atomization-job";
import { CV_PROPOSAL_LIMITS, CV_PROPOSAL_REVIEW_STATE_TEXT } from "@/lib/cv-skills-contract";


type Props = {
  userId: string;
  importId: string;
  /** Funn brukeren har gått gjennom og som kan analyseres. */
  candidates: AnalysisCandidate[];
  /** Antall funn som fortsatt venter på manuell opprydding. */
};

function proposalTitle(row: AtomEnrichmentProposalRow): string {
  const payload = (row.proposal_payload ?? {}) as Record<string, unknown>;
  const candidates = [payload["content_no"], payload["content"], payload["title"], payload["label"]];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Forslag uten tekst";
}

function proposalKindLabel(row: AtomEnrichmentProposalRow): string {
  const payload = (row.proposal_payload ?? {}) as Record<string, unknown>;
  const type = payload["atom_type"];
  if (typeof type === "string" && TARGET_ATOM_TYPE_LABELS[type]) return TARGET_ATOM_TYPE_LABELS[type];
  return "Forslag";
}

export function CvAnalysisPanel({ userId, importId, candidates }: Props) {
  const qc = useQueryClient();
  const [blocks, setBlocks] = useState<JobBlockProgress[] | null>(null);
  const [lastError, setLastError] = useState<{ message: string; retryable: boolean } | null>(null);

  const proposalsQuery = useQuery(atomEnrichmentProposalsByImportQuery(userId, importId));
  const proposals = proposalsQuery.data ?? [];

  const chunks = useMemo(() => planAnalysisChunks(candidates), [candidates]);
  const tooLarge = useMemo(() => selectionTooLarge(candidates), [candidates]);

  const pending = proposals.filter((p) => p.status === "pending_review");
  const needsContext = proposals.filter((p) => p.status === "needs_more_context");
  const handled = proposals.filter((p) => p.status === "approved" || p.status === "rejected");
  const hasRejected = proposals.some((p) => p.status === "rejected");

  const analyze = useMutation({
    mutationFn: async (regenerate: boolean) => {
      setLastError(null);
      setBlocks([]);
      const started = await startAtomizationJob({
        cvImportId: importId,
        candidateIds: candidates.map((c) => c.id),
        regenerate,
      });
      if ("error" in started) return { error: started.error };
      return await followAtomizationJob({
        jobId: started.jobId,
        onProgress: (next: JobBlockProgress[]) => setBlocks(next),
      });
    },
    onSuccess: (result) => {
      if ("error" in result) {
        setLastError(result.error);
        toast.error(result.error.message);
      } else {
        const { outcome } = result;
        if (outcome.failedBlocks.length > 0) {
          toast.warning(
            `Analysen er ferdig, men ${outcome.failedBlocks.length} del(er) må gjennomgås manuelt.`,
          );
        } else {
          toast.success(
            outcome.proposalsCreated > 0
              ? `Analysen fant ${outcome.proposalsCreated} nye forslag til gjennomgang.`
              : "Analysen er ferdig. Ingen nye forslag denne gangen.",
          );
        }
        setBlocks(null);
      }
      void qc.invalidateQueries({
        queryKey: ["atom-enrichment-proposals", userId, "import", importId],
      });
      invalidateAtomEnrichmentQueries(qc, userId);
    },
    onError: () => {
      setBlocks(null);
      setLastError({ message: "Kunne ikke analyseres akkurat nå. Prøv igjen.", retryable: true });
    },
  });


  const decide = useMutation({
    mutationFn: async (args: {
      id: string;
      decision: "approve" | "reject" | "needs_more_context";
    }) => {
      if (args.decision === "approve") return approveAtomEnrichmentProposal(userId, args.id);
      if (args.decision === "reject") return rejectAtomEnrichmentProposal(userId, args.id);
      return markAtomEnrichmentProposalNeedsContext(userId, args.id);
    },
    onSuccess: (_d, args) => {
      toast.success(
        args.decision === "approve"
          ? "Lagt til i karriereoversikten."
          : args.decision === "reject"
            ? "Forslaget er avvist."
            : "Merket som «trenger mer informasjon».",
      );
      void qc.invalidateQueries({
        queryKey: ["atom-enrichment-proposals", userId, "import", importId],
      });
      invalidateAtomEnrichmentQueries(qc, userId);
      void qc.invalidateQueries({ queryKey: ["career-atoms"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Kunne ikke behandle forslaget.");
    },
  });

  const running = analyze.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" aria-hidden />
          Analyser erfaringene dine
        </CardTitle>
        <CardDescription>
          Analysen foreslår hvordan funnene fra CV-en kan bli til roller, resultater og kompetanse.
          Ingenting lagres før du godkjenner det.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">

        {tooLarge && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Utvalget er for stort</AlertTitle>
            <AlertDescription>
              Velg færre funn — maks {CV_PROPOSAL_LIMITS.perSelection.maxCandidates} om gangen.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => analyze.mutate(false)}
            disabled={running || tooLarge || chunks.length === 0}
          >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Start analyse
          </Button>
          {hasRejected && (
            <Button
              variant="outline"
              onClick={() => analyze.mutate(true)}
              disabled={running || tooLarge || chunks.length === 0}
            >
              Analyser på nytt
            </Button>
          )}
          {chunks.length > 1 && !running && !blocks && (
            <span className="text-sm text-muted-foreground">
              Analysen kjøres i flere trinn og viser fremdrift underveis.
            </span>
          )}
        </div>

        {blocks && (
          <div className="space-y-2">
            <Progress value={jobProgressPercent(blocks)} />
            <p className="text-xs text-muted-foreground">
              Analysen kjører i bakgrunnen. Du kan lukke eller oppdatere siden — den fortsetter,
              og fremdriften vises her når du kommer tilbake.
            </p>
            <p className="text-sm text-muted-foreground">
              {blocks.length === 0
                ? "Forbereder analysen …"
                : `${blocks.filter((b) => b.status !== "queued" && b.status !== "running").length} av ${blocks.length} deler er ferdige.`}
            </p>
            <ul className="space-y-1">
              {blocks.map((block) => (
                <li
                  key={`${block.phase}:${block.block_key}`}
                  className="flex items-center gap-2 text-sm"
                >
                  {block.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : block.status === "complete" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  ) : block.status === "queued" ? (
                    <span className="h-3.5 w-3.5 rounded-full border" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className={block.status === "queued" ? "text-muted-foreground" : ""}>
                    {block.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}


        {lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Analysen stoppet</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{lastError.message}</p>
              {lastError.retryable && (
                <Button size="sm" variant="outline" onClick={() => analyze.mutate(false)}>
                  Prøv igjen
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <ProposalGroup
          title={CV_PROPOSAL_REVIEW_STATE_TEXT.new}
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          rows={pending}
          emptyText=""
          onDecide={(id, decision) => decide.mutate({ id, decision })}
          busy={decide.isPending}
        />

        {needsContext.length > 0 && (
          <ProposalGroup
            title={CV_PROPOSAL_REVIEW_STATE_TEXT.needs_more_context}
            icon={<HelpCircle className="h-4 w-4" aria-hidden />}
            rows={needsContext}
            emptyText=""
            onDecide={(id, decision) => decide.mutate({ id, decision })}
            busy={decide.isPending}
            hideNeedsContext
          />
        )}

        {handled.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {handled.length} forslag er allerede behandlet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProposalGroup({
  title,
  icon,
  rows,
  emptyText,
  onDecide,
  busy,
  hideNeedsContext,
}: {
  title: string;
  icon: React.ReactNode;
  rows: AtomEnrichmentProposalRow[];
  emptyText: string;
  onDecide: (id: string, decision: "approve" | "reject" | "needs_more_context") => void;
  busy: boolean;
  hideNeedsContext?: boolean;
}) {
  if (rows.length === 0 && !emptyText) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
        {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{proposalTitle(row)}</p>
                  <p className="text-xs text-muted-foreground">{proposalKindLabel(row)}</p>
                  {row.rationale && (
                    <p className="mt-1 text-sm text-muted-foreground">{row.rationale}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => onDecide(row.id, "approve")}>
                    Godkjenn
                  </Button>
                  {!hideNeedsContext && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onDecide(row.id, "needs_more_context")}
                    >
                      Trenger mer info
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onDecide(row.id, "reject")}
                  >
                    Avvis
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
