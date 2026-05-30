// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Loader2, AlertTriangle, Save, ExternalLink, ChevronDown, User, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/lib/supabase";
import { messageFromFunctionInvokeError } from "@/lib/edge-invoke-error";
import { companyDetailQuery, candidateFitUiState, displayCandidateFitReasoning, EMPLOYER_ANALYSIS_STEP_LABELS, latestEmployerAnalysisJobQuery, type UserRatingRow } from "@/lib/queries/companies";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

import { RatingStars } from "@/components/badges";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtDateTime } from "@/lib/format";
import { normalizeAiErrorMessage, AI_UX_RATE_LIMIT } from "@/lib/ai-ux-messages";
import { CompanyTargetAtomsSection } from "@/components/career/CompanyTargetAtomsSection";

const ANALYSIS_DIMENSION_LABELS: Record<string, string> = {
  culture: "Kultur og verdier",
  leadership: "Ledelseskvalitet",
  work_environment: "Arbeidsmiljø",
  career_development: "Karriereutvikling",
  financial_stability: "Finansiell stabilitet",
  mission: "Formål og misjon",
};

export const Route = createFileRoute("/_authenticated/employers/$companyId")({
  component: CompanyDetailPage,
});

/** Last analyze-company run (research_log entries are chronological). */
function lastAnalyzeCompanyEntry(log: unknown) {
  const arr = Array.isArray(log) ? (log as unknown[]) : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i] as { via?: string; status?: string } | null;
    if (e?.via === "analyze-company") return e;
  }
  return null;
}

const COMPANY_AI_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "ai_culture_score", label: "Kultur og verdier" },
  { key: "ai_leadership_score", label: "Ledelseskvalitet" },
  { key: "ai_work_environment_score", label: "Arbeidsmiljø" },
  { key: "ai_career_development_score", label: "Karriereutvikling" },
  { key: "ai_financial_stability_score", label: "Finansiell stabilitet" },
  { key: "ai_mission_score", label: "Formål og misjon" },
];

const USER_RATING_DIMENSIONS: Array<{ key: keyof UserRatingRow; label: string }> = [
  { key: "culture_score", label: "Kultur og verdier" },
  { key: "leadership_score", label: "Ledelseskvalitet" },
  { key: "work_environment_score", label: "Arbeidsmiljø" },
  { key: "career_development_score", label: "Karriereutvikling" },
  { key: "financial_stability_score", label: "Finansiell stabilitet" },
  { key: "mission_score", label: "Formål og misjon" },
  { key: "overall_score", label: "Helhetsinntrykk" },
];

const AGG_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "agg_culture_score", label: "Kultur og verdier" },
  { key: "agg_leadership_score", label: "Ledelseskvalitet" },
  { key: "agg_work_environment_score", label: "Arbeidsmiljø" },
  { key: "agg_career_development_score", label: "Karriereutvikling" },
  { key: "agg_financial_stability_score", label: "Finansiell stabilitet" },
  { key: "agg_mission_score", label: "Formål og misjon" },
  { key: "agg_overall_score", label: "Helhetsinntrykk" },
];

function StarsRow({ label, value }: { label: string; value: number | null | undefined }) {
  const rounded = value == null ? null : Math.round(Number(value));
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
          {value == null ? "—" : Number(value).toFixed(1)}
        </span>
        <RatingStars value={rounded ?? undefined} readOnly />
      </div>
    </div>
  );
}

function CompanyDetailPage() {
  const { companyId } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(companyDetailQuery(companyId));
  const { data: analysisJob } = useQuery(latestEmployerAnalysisJobQuery(companyId));

  const company = data?.company;
  const myRating = data?.myRating ?? null;

  const researchLog = useMemo<any[]>(
    () => (Array.isArray(company?.research_log) ? (company!.research_log as any[]) : []),
    [company],
  );
  const lastAnalyzeEntry = useMemo(
    () => lastAnalyzeCompanyEntry(company?.research_log),
    [company?.research_log],
  );
  const analysisRunStatus = (lastAnalyzeEntry?.status as string | undefined) ?? null;

  const lastSources: string[] = useMemo(() => {
    for (let i = researchLog.length - 1; i >= 0; i--) {
      const entry = researchLog[i];
      if (Array.isArray(entry?.sources) && entry.sources.length) return entry.sources;
    }
    return [];
  }, [researchLog]);
  /** Prefer URLs from the latest analyze-company run (not other research tooling). */
  const analyzeCompanySources: string[] = useMemo(() => {
    const e = lastAnalyzeCompanyEntry(company?.research_log) as { sources?: string[] } | null;
    return Array.isArray(e?.sources) ? e.sources.filter((u) => typeof u === "string" && u.trim().length > 0) : [];
  }, [company?.research_log]);
  const displaySources = analyzeCompanySources.length > 0 ? analyzeCompanySources : lastSources;
  const lastDimensions: string[] = useMemo(() => {
    for (let i = researchLog.length - 1; i >= 0; i--) {
      const entry = researchLog[i];
      if (Array.isArray(entry?.dimensions) && entry.dimensions.length) return entry.dimensions;
    }
    return [
      "culture",
      "leadership",
      "work_environment",
      "career_development",
      "financial_stability",
      "mission",
    ];
  }, [researchLog]);

  // Local state for editable rating
  const [scores, setScores] = useState<Record<string, number>>({});
  const [openDim, setOpenDim] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState({
    applied_here: false,
    interviewed_here: false,
    worked_here: false,
  });

  useEffect(() => {
    if (myRating) {
      const next: Record<string, number> = {};
      USER_RATING_DIMENSIONS.forEach(({ key }) => {
        const v = (myRating as any)[key];
        next[key as string] = typeof v === "number" ? v : 3;
      });
      setScores(next);
      setNotes(myRating.user_notes ?? "");
      setFlags({
        applied_here: !!myRating.applied_here,
        interviewed_here: !!myRating.interviewed_here,
        worked_here: !!myRating.worked_here,
      });
    } else {
      const empty: Record<string, number> = {};
      USER_RATING_DIMENSIONS.forEach(({ key }) => (empty[key as string] = 3));
      setScores(empty);
      setNotes("");
      setFlags({ applied_here: false, interviewed_here: false, worked_here: false });
    }
  }, [myRating]);

  useEffect(() => {
    if (
      analysisJob?.status === "completed" ||
      analysisJob?.status === "failed" ||
      analysisJob?.status === "rate_limited"
    ) {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employers"] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-jobs", "active"] });
    }
  }, [analysisJob?.status, companyId, qc]);

  const aiMutation = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Ikke innlogget");
      const { data: result, error } = await supabase.functions.invoke("analyze-company", {
        body: { company_id: companyId, user_id: uid },
      });
      if (error) throw new Error(await messageFromFunctionInvokeError(error, result));
      if ((result as any)?.error) {
        throw new Error(
          normalizeAiErrorMessage(
            (result as any).message ?? String((result as any).error),
            { kind: "analysis" },
          ),
        );
      }
      return result;
    },
    onSuccess: (result: any) => {
      if (result?.rate_limited_wait) {
        toast.message("AI-tjenesten er midlertidig opptatt", {
          description: result.retry_after_at
            ? `Prøv igjen etter ${fmtDateTime(result.retry_after_at)}.`
            : "Prøv igjen om litt.",
        });
      } else if (result?.status === "cached") {
        const dt = result.ai_rated_at ? new Date(result.ai_rated_at).toLocaleDateString("nb-NO") : "";
        toast.success("Bruker eksisterende selskapsanalyse", {
          description: `Analyse fra ${dt}. Beregner din kandidatmatch…`,
        });
      } else {
        toast.success("AI-analyse startet", {
          description: "Henter informasjon fra nettet — siden oppdaterer seg når analysen er ferdig.",
        });
      }
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employers"] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-job", companyId] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-jobs", "active"] });
    },
    onError: (err: any) => {
      toast.error(normalizeAiErrorMessage(err?.message, { kind: "analysis" }));
    },
  });

  const jobRunning = analysisJob?.status === "queued" || analysisJob?.status === "processing";
  const jobRateLimited = analysisJob?.status === "rate_limited";
  const rateLimitRetryAt =
    jobRateLimited && analysisJob?.retry_after_at && new Date(analysisJob.retry_after_at) > new Date()
      ? analysisJob.retry_after_at
      : null;
  const jobFailed = analysisJob?.status === "failed";
  const isAnalysisFailed = jobFailed || (!jobFailed && !jobRateLimited && analysisRunStatus === "failed");
  const isAnalysisRunPending =
    jobRunning || (!analysisJob && analysisRunStatus === "pending" && !jobRateLimited);
  const isAnalysisInFlight =
    jobRunning || (aiMutation.isPending && analysisRunStatus !== "failed" && !jobFailed && !jobRateLimited);

  const failureMessageRaw =
    (jobFailed ? analysisJob?.error_message : null) ??
    (lastAnalyzeEntry as { reason?: string } | null)?.reason ??
    null;
  const failureMessage = failureMessageRaw
    ? normalizeAiErrorMessage(failureMessageRaw, { kind: "analysis" })
    : null;

  const rateLimitMessageRaw = jobRateLimited ? (analysisJob?.error_message ?? "").trim() : "";
  const rateLimitMessage = jobRateLimited
    ? normalizeAiErrorMessage(rateLimitMessageRaw || AI_UX_RATE_LIMIT, { kind: "analysis" })
    : "";

  useEffect(() => {
    if (!isAnalysisInFlight) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
    }, 4000);
    return () => clearInterval(t);
  }, [isAnalysisInFlight, companyId, qc]);

  const ratingMutation = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Ikke innlogget");

      const payload: any = {
        user_id: uid,
        company_id: companyId,
        user_notes: notes || null,
        ...flags,
      };
      USER_RATING_DIMENSIONS.forEach(({ key }) => {
        payload[key] = scores[key as string] ?? null;
      });

      const { error } = await supabase
        .from("user_company_ratings")
        .upsert(payload, { onConflict: "user_id,company_id" });
      if (error) throw error;

      const { error: rpcErr } = await supabase.rpc("refresh_company_aggregate", {
        p_company_id: companyId,
      });
      if (rpcErr) throw rpcErr;
    },
    onSuccess: () => {
      toast.success("Vurdering lagret");
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employers"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Kunne ikke lagre"),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-sm text-muted-foreground">Selskap ikke funnet.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/employers">Tilbake</Link>
        </Button>
      </div>
    );
  }

  const aiRatedAt = company.ai_rated_at ? new Date(company.ai_rated_at) : null;
  const hasAi = !!aiRatedAt;
  const isFresh = aiRatedAt ? Date.now() - aiRatedAt.getTime() < 24 * 60 * 60 * 1000 : false;
  const aggCount = company.agg_rating_count ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/employers">
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Link>
        </Button>
      </div>

      <header>
        <h1 className="text-2xl font-display font-bold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[company.industry, company.size_estimate, company.country, company.domain]
            .filter(Boolean)
            .join(" · ")}
          {company.domain && (
            <>
              {" · "}
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {company.domain}
              </a>
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-3xl">
          <strong className="text-foreground/85">AI selskap</strong> er felles for alle brukere.{" "}
          <strong className="text-foreground/85">Din kandidatmatch</strong> og{" "}
          <strong className="text-foreground/85">Min vurdering</strong> er bare for deg.{" "}
          <strong className="text-foreground/85">Brukersnitt</strong> er gjennomsnitt av alle manuelle vurderinger.
        </p>
      </header>

      <CompanyTargetAtomsSection companyId={companyId} company={company} />

      {/* Section 1: AI-vurdering (selskap — felles for alle) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> AI-vurdering (selskap)
          </CardTitle>
          <CardDescription>
            Åpne fakta og vurderinger fra nett — lagret på selskapet og delt mellom brukere. Ingen personlig
            kandidatmatch her.
          </CardDescription>
          {aiRatedAt && (
            <CardDescription>
              Sist oppdatert {fmtDateTime(aiRatedAt.toISOString())}
              {isFresh && (
                <span className="ml-2 text-emerald-600 font-medium">
                  (oppdatert i dag)
                </span>
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isAnalysisFailed && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm min-w-0">
                <p className="font-medium text-destructive">AI-analyse feilet</p>
                <p className="text-muted-foreground text-xs break-words">
                  {failureMessage ?? "Prøv «Kjør AI-analyse på nytt» nedenfor."}
                </p>
              </div>
            </div>
          )}

          {jobRateLimited && (
            <div className="rounded-md border border-amber-600/35 bg-amber-500/10 p-3 flex items-start gap-3">
              <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm min-w-0 space-y-1">
                <p className="font-medium text-amber-900 dark:text-amber-100">Midlertidig AI-begrensning</p>
                <p className="text-muted-foreground text-xs break-words">
                  {rateLimitMessage || AI_UX_RATE_LIMIT}
                </p>
                {rateLimitRetryAt && (
                  <p className="text-xs text-amber-900/90 dark:text-amber-50/90">
                    Prøv igjen etter {fmtDateTime(rateLimitRetryAt)}.
                  </p>
                )}
              </div>
            </div>
          )}

          {isAnalysisInFlight && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5 shrink-0" />
              <div className="text-sm flex-1 min-w-0 space-y-2">
                <p className="font-medium">
                  {jobRunning
                    ? EMPLOYER_ANALYSIS_STEP_LABELS[analysisJob?.current_step ?? ""] ??
                      analysisJob?.current_step ??
                      "Behandler…"
                    : aiMutation.isPending
                      ? "Starter analyse…"
                      : "Behandler…"}
                </p>
                {jobRunning && (
                  <>
                    <Progress value={analysisJob?.progress_percent ?? 0} className="h-2 max-w-md" />
                    <p className="text-muted-foreground text-xs">
                      {analysisJob?.progress_percent ?? 0}% — fremdrift lagres i databasen. Du kan navigere bort
                      og komme tilbake; oppdateringen fortsetter i bakgrunnen.
                    </p>
                  </>
                )}
                {!jobRunning && (
                  <p className="text-muted-foreground text-xs">
                    Status sendes til server — siden henter siste resultat automatisk.
                  </p>
                )}
              </div>
            </div>
          )}

          {hasAi ? (
            <>
              <div className="divide-y">
                <StarsRow label="Samlet AI-score (selskap)" value={(company as any).ai_overall_score} />
                {COMPANY_AI_DIMENSIONS.map(({ key, label }) => (
                  <StarsRow key={key} label={label} value={(company as any)[key]} />
                ))}
              </div>
              {company.ai_rating_notes && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Sammendrag
                  </h4>
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-2 prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{company.ai_rating_notes}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          ) : !isAnalysisInFlight && !isAnalysisFailed ? (
            <p className="text-sm text-muted-foreground">AI-analyse ikke gjennomført ennå.</p>
          ) : null}

          {(hasAi || isAnalysisInFlight) && lastDimensions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Vurderte områder
                <span className="normal-case font-normal text-muted-foreground/80"> — klikk for detaljert begrunnelse</span>
              </p>
              <div className="rounded-lg border divide-y overflow-hidden">
                {lastDimensions.map((d) => {
                  const isOpen = openDim === d;
                  const note = (company as any).ai_dimension_notes?.[d];
                  return (
                    <div key={d}>
                      <button
                        type="button"
                        onClick={() => setOpenDim(isOpen ? null : d)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/50 transition-colors"
                      >
                        <span className="font-medium">{ANALYSIS_DIMENSION_LABELS[d] ?? d}</span>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-0 text-sm text-muted-foreground bg-muted/20">
                          {note ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-2 prose-li:my-0.5">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(note)}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap pt-1">
                              Ingen detaljert begrunnelse lagret. Kjør analyse på nytt for å hente
                              per-dimensjon-begrunnelser.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {displaySources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Kilder
              </p>
              <ul className="space-y-1">
                {displaySources.map((url, i) => (
                  <li key={i}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1 break-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => aiMutation.mutate()}
              disabled={aiMutation.isPending || isAnalysisInFlight}
              variant={hasAi ? "outline" : "default"}
            >
              {aiMutation.isPending || isAnalysisInFlight ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Analyserer…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {hasAi ? "Oppdater AI-analyse" : "Start AI-analyse"}
                </>
              )}
            </Button>
            {isFresh && !isAnalysisInFlight && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 cursor-help">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      AI-analyse er oppdatert i dag
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Ny analyse vil overskrive eksisterende data.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Din kandidatmatch — per bruker (user_company_ratings) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" /> Din kandidatmatch
          </CardTitle>
          <CardDescription>
            Personlig treffmot selskapet — lagret på din bruker-rad for dette selskapet, ikke på selskapets felles
            profil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            const fitState = candidateFitUiState(myRating);
            if (fitState === "unavailable") {
              return (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm space-y-2">
                  <p className="font-medium text-amber-900 dark:text-amber-100">Kan ikke vurderes</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-2 prose-ul:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {displayCandidateFitReasoning(myRating?.ai_candidate_fit_reasoning ?? "")}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            }
            if (fitState === "partial") {
              return (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-sm space-y-2">
                  <p className="font-medium">Match ikke fullført som tall-score</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {displayCandidateFitReasoning(myRating?.ai_candidate_fit_reasoning ?? "")}
                    </ReactMarkdown>
                  </div>
                  {hasAi && (
                    <p className="text-xs text-muted-foreground">
                      Prøv «Oppdater AI-analyse» for å hente en numerisk match (1–5).
                    </p>
                  )}
                </div>
              );
            }
            if (fitState === "rated") {
              return (
                <>
                  <div className="divide-y">
                    <StarsRow label="AI kandidatmatch (deg)" value={myRating?.ai_candidate_fit_score ?? null} />
                  </div>
                  {myRating?.ai_candidate_fit_reasoning && (
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Begrunnelse
                      </h4>
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-2 prose-li:my-0.5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {displayCandidateFitReasoning(myRating.ai_candidate_fit_reasoning)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </>
              );
            }
            if (hasAi) {
              return (
                <p className="text-sm text-muted-foreground">
                  Kandidatmatch beregnes etter selskapsanalysen. Kjør «Oppdater AI-analyse» hvis den ikke vises — den
                  bruker din profil og lagres kun for deg.
                </p>
              );
            }
            return (
              <p className="text-sm text-muted-foreground">
                Start selskapsanalysen over først; deretter kan vi beregne din personlige match mot dette selskapet.
              </p>
            );
          })()}
        </CardContent>
      </Card>

      {/* Section 2: Min vurdering */}
      <Card>
        <CardHeader>
          <CardTitle>Min vurdering</CardTitle>
          {!myRating && (
            <CardDescription>
              Legg til din vurdering — flytt slidere og lagre nederst.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5">
            {USER_RATING_DIMENSIONS.map(({ key, label }) => {
              const k = key as string;
              const v = scores[k] ?? 3;
              return (
                <div key={k} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{label}</Label>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {v.toFixed(1)} / 5
                    </span>
                  </div>
                  <Slider
                    value={[v]}
                    min={1}
                    max={5}
                    step={0.5}
                    onValueChange={([nv]) => setScores((s) => ({ ...s, [k]: nv }))}
                  />
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-notes">Notat</Label>
            <Textarea
              id="user-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Egne observasjoner om selskapet…"
              rows={3}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            {(["applied_here", "interviewed_here", "worked_here"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={flags[f]}
                  onCheckedChange={(v) => setFlags((s) => ({ ...s, [f]: !!v }))}
                />
                {f === "applied_here" ? "Søkt her" : f === "interviewed_here" ? "Intervjuet her" : "Jobbet her"}
              </label>
            ))}
          </div>

          <Button onClick={() => ratingMutation.mutate()} disabled={ratingMutation.isPending}>
            {ratingMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Lagrer…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Lagre vurdering
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Section 3: Brukersnitt (alle brukere) */}
      <Card>
        <CardHeader>
          <CardTitle>Brukersnitt</CardTitle>
          <CardDescription>
            Gjennomsnitt av manuelle vurderinger fra alle brukere — lagret som aggregat på selskapet. Ikke din
            personlige AI-match.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aggCount > 0 ? (
            <>
              <div className="divide-y">
                {AGG_DIMENSIONS.map(({ key, label }) => (
                  <StarsRow key={key} label={label} value={(company as any)[key]} />
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Basert på {aggCount} {aggCount === 1 ? "vurdering" : "vurderinger"} fra brukere i systemet.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ingen data — ingen har lagret vurdering for dette selskapet ennå.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Søkeres vurdering av jobbprosess */}
      {((company as any).agg_process_count ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Søkeres vurdering av selskapets jobbprosess</CardTitle>
            <CardDescription>
              Basert på {(company as any).agg_process_count} {(company as any).agg_process_count === 1 ? "vurdering" : "vurderinger"} fra brukere som har avsluttet en søknad hos selskapet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              <StarsRow label="Totalvurdering" value={(company as any).agg_process_overall} />
              <StarsRow label="Bekreftelse på mottatt søknad" value={(company as any).agg_process_q1} />
              <StarsRow label="Ryddig og forutsigbar kommunikasjon" value={(company as any).agg_process_q2} />
              <StarsRow label="Respektfull og profesjonell behandling" value={(company as any).agg_process_q3} />
              <StarsRow label="Konstruktiv tilbakemelding" value={(company as any).agg_process_q4} />
              <StarsRow label="Holdt avtaler om tidslinjer" value={(company as any).agg_process_q5} />
              <StarsRow label="Vil anbefale som arbeidsgiver" value={(company as any).agg_process_q6} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
