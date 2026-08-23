// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Loader2, AlertTriangle, Save, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { messageFromFunctionInvokeError } from "@/lib/edge-invoke-error";
import {
  companyDetailQuery,
  EMPLOYER_ANALYSIS_STEP_LABELS,
  latestEmployerAnalysisJobQuery,
  type UserRatingRow,
} from "@/lib/queries/companies";
import { employerAnalysisViewQuery } from "@/lib/queries/employer-analysis-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { RatingStars } from "@/components/badges";
import { fmtDateTime } from "@/lib/format";
import { normalizeAiErrorMessage, AI_UX_RATE_LIMIT } from "@/lib/ai-ux-messages";

import { EmployerAnalysisReportV2 } from "@/components/employers/EmployerAnalysisReportV2";
import { EmployerCandidateMatch } from "@/components/employers/EmployerCandidateMatch";
import { EmployerCommonReview } from "@/components/employers/EmployerCommonReview";
import { employerAnalysisDocsForCompanyQuery } from "@/lib/queries/employer-analysis-docs";

export const Route = createFileRoute("/_authenticated/employers/$companyId")({
  component: CompanyDetailPage,
});

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
  const { user } = useAuth();
  const userKey = user?.id ?? "anon";
  const { data, isLoading } = useQuery(companyDetailQuery(companyId));
  const { data: analysisJob } = useQuery(latestEmployerAnalysisJobQuery(companyId));

  const company = data?.company;
  const myRating = data?.myRating ?? null;
  const orgnr = (company as any)?.organisasjonsnummer ?? null;

  // Lagrede analysedokumenter: kobles bare når selskapet har organisasjonsnummer.
  const { data: analysisDocs } = useQuery(
    employerAnalysisDocsForCompanyQuery(companyId, orgnr ? (company as any)?.name : null),
  );
  const savedAnalysisDocs = (analysisDocs ?? []) as any[];

  // K3 + K5: ubetinget hook med enabled-flagg.
  const {
    data: envelope,
    isPending: envelopePending,
    isError: envelopeError,
    error: envelopeErrorObj,
    refetch: envelopeRefetch,
  } = useQuery(employerAnalysisViewQuery(orgnr, userKey));

  // K5: hasAnalysis utledes utelukkende fra V2-envelope, og krever validert utdata.
  const analysisValidated =
    (company as { employer_analysis_output_validation_status?: string | null } | undefined)
      ?.employer_analysis_output_validation_status === "valid";
  const hasAnalysis =
    !!envelope?.analysis && !!envelope?.company?.analysis_rated_at && analysisValidated;

  // K4: invalider også V2-query når jobben endrer status terminalt.
  useEffect(() => {
    if (
      analysisJob?.status === "completed" ||
      analysisJob?.status === "failed" ||
      analysisJob?.status === "rate_limited"
    ) {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employers"] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-jobs", "active"] });
      if (orgnr) {
        qc.invalidateQueries({
          queryKey: ["employer-analysis-view", orgnr, userKey],
        });
      }
    }
  }, [analysisJob?.status, companyId, qc, orgnr, userKey]);

  // Local state for editable rating
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState({
    applied_here: false,
    interviewed_here: false,
    worked_here: false,
  });

  useEffect(() => {
    if (myRating) {
      // Kun reelle, lagrede verdier fylles inn. Manglende svar forblir uvurdert.
      const next: Record<string, number> = {};
      USER_RATING_DIMENSIONS.forEach(({ key }) => {
        const v = (myRating as any)[key];
        if (typeof v === "number") next[key as string] = v;
      });
      setScores(next);
      setNotes(myRating.user_notes ?? "");
      setFlags({
        applied_here: !!myRating.applied_here,
        interviewed_here: !!myRating.interviewed_here,
        worked_here: !!myRating.worked_here,
      });
    } else {
      setScores({});
      setNotes("");
      setFlags({ applied_here: false, interviewed_here: false, worked_here: false });
    }
  }, [myRating]);

  const aiMutation = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Ikke innlogget");
      const { data: result, error } = await supabase.functions.invoke("analyze-company", {
        body: { company_id: companyId, user_id: uid, force: true },
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
      } else {
        toast.success("AI-analyse startet", {
          description: "Henter informasjon fra nettet — siden oppdaterer seg når analysen er ferdig.",
        });
      }
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employers"] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-job", companyId] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-jobs", "active"] });
      if (orgnr) {
        qc.invalidateQueries({
          queryKey: ["employer-analysis-view", orgnr, userKey],
        });
      }
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
  const isAnalysisInFlight = jobRunning || aiMutation.isPending;

  const failureMessageRaw = jobFailed ? analysisJob?.error_message ?? null : null;
  const failureMessage = failureMessageRaw
    ? normalizeAiErrorMessage(failureMessageRaw, { kind: "analysis" })
    : null;

  const rateLimitMessageRaw = jobRateLimited ? (analysisJob?.error_message ?? "").trim() : "";
  const rateLimitMessage = jobRateLimited
    ? normalizeAiErrorMessage(rateLimitMessageRaw || AI_UX_RATE_LIMIT, { kind: "analysis" })
    : "";

  // Background polling for in-flight jobs.
  useEffect(() => {
    if (!isAnalysisInFlight) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-job", companyId] });
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

  const aggCount = (company as any).agg_rating_count ?? 0;

  const jobStatusSlot = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => aiMutation.mutate()}
          disabled={aiMutation.isPending || isAnalysisInFlight}
          variant={hasAnalysis ? "outline" : "default"}
          size="sm"
        >
          {aiMutation.isPending || isAnalysisInFlight ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Analyserer…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {hasAnalysis ? "Oppdater analyse" : "Start analyse"}
            </>
          )}
        </Button>
      </div>

      {jobFailed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-sm min-w-0">
            <p className="font-medium text-destructive">Analyse feilet</p>
            <p className="text-muted-foreground text-xs break-words">
              {failureMessage ?? "Prøv «Oppdater analyse»."}
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
                : "Starter analyse…"}
            </p>
            {jobRunning && (
              <>
                <Progress value={analysisJob?.progress_percent ?? 0} className="h-2 max-w-md" />
                <p className="text-muted-foreground text-xs">
                  {analysisJob?.progress_percent ?? 0}% — fremdrift lagres i databasen. Du kan navigere
                  bort og komme tilbake; oppdateringen fortsetter i bakgrunnen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-10">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/employers">
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Link>
        </Button>
      </div>

      {savedAnalysisDocs.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lagrede arbeidsgiveranalyser</CardTitle>
            <CardDescription>
              Analysedokumenter knyttet til {company.name} via navn og organisasjonsnummer.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y">
              {savedAnalysisDocs.map((d: any) => (
                <li key={d.id}>
                  <Link
                    to="/documents/$id"
                    params={{ id: d.id }}
                    className="flex items-center gap-2 py-2 text-sm hover:underline"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDateTime(d.updated_at ?? d.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}



      {envelopeError ? (
        <div className="space-y-4">
          {jobStatusSlot}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
            <p className="text-sm font-medium text-foreground">
              Kunne ikke hente arbeidsgiveranalysen
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {envelopeErrorObj instanceof Error
                ? envelopeErrorObj.message
                : "Ukjent feil"}
            </p>
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => envelopeRefetch()}>
                Prøv igjen
              </Button>
            </div>
          </div>
        </div>
      ) : envelope && analysisValidated ? (
        <EmployerAnalysisReportV2
          envelope={envelope}
          mode="authenticated"
          jobStatusSlot={jobStatusSlot}
          candidateMatchSlot={
            <EmployerCandidateMatch myRating={myRating} hasAnalysis={hasAnalysis} />
          }
        />
      ) : (
        <div className="space-y-4">
          <header>
            <h1 className="text-2xl font-display font-bold tracking-tight">{company.name}</h1>
            {orgnr ? (
              <p className="text-sm text-muted-foreground">
                Organisasjonsnummer <span className="tabular-nums">{orgnr}</span>
              </p>
            ) : null}
          </header>
          {jobStatusSlot}
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            {!orgnr
              ? "Mangler organisasjonsnummer på selskapet — kan ikke vise arbeidsgiveranalyse."
              : envelopePending
                ? "Henter arbeidsgiveranalyse…"
                : envelope
                  ? "Analysen mangler gyldig grunnlag og vises ikke. Start analysen på nytt med verifisert organisasjonsnummer."
                  : "Ingen arbeidsgiveranalyse tilgjengelig."}
          </div>
        </div>
      )}

      {/* Min vurdering — bevart, men adskilt fra canonical V2-rapport */}
      <Card>
        <CardHeader>
          <CardTitle>Min vurdering</CardTitle>
          {!myRating && (
            <CardDescription>
              Legg til din egen vurdering — flytt slidere og lagre nederst.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5">
            {USER_RATING_DIMENSIONS.map(({ key, label }) => {
              const k = key as string;
              const v = scores[k];
              const rated = typeof v === "number";
              return (
                <div key={k} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>{label}</Label>
                    {rated ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {v.toFixed(1)} / 5
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setScores((s) => {
                              const next = { ...s };
                              delete next[k];
                              return next;
                            })
                          }
                        >
                          Ikke nok grunnlag
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">Ikke vurdert</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setScores((s) => ({ ...s, [k]: 3 }))}
                        >
                          Gi vurdering
                        </Button>
                      </div>
                    )}
                  </div>
                  {rated ? (
                    <Slider
                      value={[v]}
                      min={1}
                      max={5}
                      step={0.5}
                      onValueChange={([nv]) => setScores((s) => ({ ...s, [k]: nv }))}
                    />
                  ) : null}
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

      <EmployerCommonReview companyId={companyId} orgnr={orgnr} />

      {/* Brukersnitt */}
      <Card>
        <CardHeader>
          <CardTitle>Brukersnitt</CardTitle>
          <CardDescription>
            Gjennomsnitt av manuelle vurderinger fra alle brukere — lagret som aggregat på selskapet.
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

      {/* Søkeres vurdering av jobbprosess */}
      {((company as any).agg_process_count ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Søkeres vurdering av selskapets jobbprosess</CardTitle>
            <CardDescription>
              Basert på {(company as any).agg_process_count}{" "}
              {(company as any).agg_process_count === 1 ? "vurdering" : "vurderinger"} fra brukere som har avsluttet en søknad hos selskapet.
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
