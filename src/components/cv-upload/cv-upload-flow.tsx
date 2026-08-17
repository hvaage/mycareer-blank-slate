/**
 * Sammenhengende CV-flyt: velg fil → opplasting → analyse → oppsummering.
 *
 * Analysen starter automatisk når opplastingen er verifisert fullført, slik at
 * brukeren ikke må trykke «Analyser CV» som et eget steg. Den gamle flate
 * avhukingslisten er borte som brukerflyt: bekreftelse skjer i gjennomgangen
 * på fire trinn. Ingenting her skriver til karriereoversikten.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, FileText, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { CvDropzone } from "./dropzone";
import { ArchiveCvPicker } from "./archive-picker";
import { messageFor } from "./error-messages";
import {
  cancelImport,
  countsFromParsed,
  parsedShapeIsReadable,
  useCommitImport,
  useRegisterCvUpload,
  useResumableImport,
  useRunCvParse,
} from "@/lib/queries/cv-imports";
import {
  useImportArchivedCv,
  type ArchivedCvSource,
} from "@/lib/queries/cv-archive-sources";
import {
  cancelAtomizationJob,
  followAtomizationJob,
  jobProgressPercent,
  resumeAtomizationJob,
  startAtomizationJob,
  type JobBlockProgress,
  type JobOutcome,
} from "@/lib/cv-atomization-job";
import { Link } from "@tanstack/react-router";
import { useCreateDocumentationDrafts } from "@/lib/queries/cv-documentation-drafts";
import { supabase } from "@/lib/supabase";
import type { CommitResponse, PreviewCounts } from "@/types/cv-upload";

type Stage =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "parsing"; importId: string; fileName: string }
  | { kind: "preparing"; importId: string; fileName: string }
  | { kind: "analyzing"; importId: string; fileName: string; jobId: string }
  | {
      kind: "summary";
      importId: string;
      fileName: string;
      jobId: string | null;
      outcome: JobOutcome | null;
      counts: PreviewCounts | null;
      commit: CommitResponse | null;
    }
  | {
      kind: "error";
      from: "upload" | "parse" | "prepare" | "analyze";
      errorCode: string;
      message?: string;
      importId?: string;
      fileName?: string;
    };

interface Props {
  userId: string;
  onCompleted?: (result: CommitResponse) => void;
  /** Compact variant for onboarding step */
  compact?: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  uploading: "Laster opp filen…",
  parsing: "Leser innholdet i CV-en…",
  preparing: "Klargjør analysegrunnlaget…",
  analyzing: "Analyserer roller, resultater og kompetanser…",
};

export function CvUploadFlow({ userId, onCompleted, compact }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [blocks, setBlocks] = useState<JobBlockProgress[]>([]);
  const [counts, setCounts] = useState<PreviewCounts | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const follow = useRef<AbortController | null>(null);

  const register = useRegisterCvUpload(userId);
  const runParse = useRunCvParse(userId);
  const commit = useCommitImport(userId);
  const importArchived = useImportArchivedCv(userId);
  const docDrafts = useCreateDocumentationDrafts(userId);
  const resumable = useResumableImport(userId);
  const [resumedId, setResumedId] = useState<string | null>(null);

  useEffect(() => () => follow.current?.abort(), []);

  /** Følger en jobb til den er ferdig, avbrutt eller delvis. */
  const watchJob = useCallback(
    async (importId: string, fileName: string, jobId: string, parsedCounts: PreviewCounts | null) => {
      follow.current?.abort();
      const controller = new AbortController();
      follow.current = controller;
      setStage({ kind: "analyzing", importId, fileName, jobId });

      const res = await followAtomizationJob({
        jobId,
        signal: controller.signal,
        onProgress: (b) => setBlocks(b),
      });
      if (controller.signal.aborted) return;
      if ("error" in res) {
        setStage({
          kind: "error",
          from: "analyze",
          errorCode: "database_error",
          message: res.error.message,
          importId,
          fileName,
        });
        return;
      }
      setStage({
        kind: "summary",
        importId,
        fileName,
        jobId,
        outcome: res.outcome,
        counts: parsedCounts,
        commit: null,
      });
    },
    [],
  );

  /** Kjører hele kjeden fra en opplastet import: tolkning → grunnlag → analyse. */
  const runPipeline = useCallback(
    async (importId: string, fileName: string) => {
      setBlocks([]);
      setStage({ kind: "parsing", importId, fileName });
      let raw: unknown = null;
      try {
        // En import som allerede er tolket skal ikke tolkes på nytt: tjenesten
        // godtar bare «pending»/«failed», og et nytt kall ville gitt en feil
        // som ser ut som at analysen mislyktes.
        const { data: existing } = await supabase
          .from("cv_imports")
          .select("raw_parsed_data, status")
          .eq("id", importId)
          .maybeSingle();
        const alreadyParsed =
          !!existing?.raw_parsed_data && parsedShapeIsReadable(existing.raw_parsed_data);
        if (!alreadyParsed) await runParse.mutateAsync(importId);

        const { data: row, error } = await supabase
          .from("cv_imports")
          .select("raw_parsed_data, source_filename")
          .eq("id", importId)
          .maybeSingle();
        if (error || !row?.raw_parsed_data || !parsedShapeIsReadable(row.raw_parsed_data)) {
          setStage({
            kind: "error",
            from: "parse",
            errorCode: "parse_failed",
            message: error
              ? `Kunne ikke hente analyseresultat: ${error.message}`
              : "Vi fikk et svar vi ikke klarte å lese. Det betyr ikke at CV-en er tom — prøv igjen.",
            importId,
            fileName,
          });
          return;
        }
        raw = row.raw_parsed_data;
      } catch (e: any) {
        setStage({
          kind: "error",
          from: "parse",
          errorCode: e?.code ?? "parse_failed",
          message: e?.message,
          importId,
          fileName,
        });
        return;
      }

      const parsedCounts = countsFromParsed(raw);
      setCounts(parsedCounts);

      setStage({ kind: "preparing", importId, fileName });
      let commitResult: CommitResponse;
      try {
        commitResult = await commit.mutateAsync(importId);
      } catch (e: any) {
        setStage({
          kind: "error",
          from: "prepare",
          errorCode: e?.code ?? "database_error",
          message: e?.message,
          importId,
          fileName,
        });
        return;
      }
      onCompleted?.(commitResult);

      const started = await startAtomizationJob({ cvImportId: importId });
      if ("error" in started) {
        setStage({
          kind: "error",
          from: "analyze",
          errorCode: "database_error",
          message: started.error.message,
          importId,
          fileName,
        });
        return;
      }
      await watchJob(importId, fileName, started.jobId, parsedCounts);
    },
    [commit, onCompleted, runParse, watchJob],
  );

  /** Gjenopptar en påbegynt import etter navigasjon eller refresh. */
  useEffect(() => {
    if (stage.kind !== "idle") return;
    const row = resumable.data;
    if (!row || row.id === resumedId) return;
    setResumedId(row.id);
    const fileName = (row as any).source_filename ?? "CV";
    const raw = (row as any).raw_parsed_data;

    void (async () => {
      if (!raw || !parsedShapeIsReadable(raw)) {
        await runPipeline(row.id, fileName);
        return;
      }
      const parsedCounts = countsFromParsed(raw);
      setCounts(parsedCounts);
      const { data: job } = await supabase
        .from("cv_atomization_jobs")
        .select("id, status")
        .eq("cv_import_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const jobRow = job as { id: string; status: string } | null;
      if (jobRow && (jobRow.status === "queued" || jobRow.status === "running")) {
        await watchJob(row.id, fileName, jobRow.id, parsedCounts);
        return;
      }
      if (jobRow) {
        await watchJob(row.id, fileName, jobRow.id, parsedCounts);
        return;
      }
      const started = await startAtomizationJob({ cvImportId: row.id });
      if ("error" in started) {
        setStage({
          kind: "error",
          from: "analyze",
          errorCode: "database_error",
          message: started.error.message,
          importId: row.id,
          fileName,
        });
        return;
      }
      await watchJob(row.id, fileName, started.jobId, parsedCounts);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind, resumable.data?.id]);

  const onFileSelected = async (file: File) => {
    setStage({ kind: "uploading", fileName: file.name });
    try {
      const res = await register.mutateAsync(file);
      await runPipeline(res.import_id, res.source_filename);
    } catch (e: any) {
      setStage({
        kind: "error",
        from: "upload",
        errorCode: e?.code ?? "upload_failed",
        message: e?.message,
      });
    }
  };

  const onUseArchived = async (source: ArchivedCvSource) => {
    setStage({ kind: "uploading", fileName: source.filename ?? "CV" });
    try {
      const res = await importArchived.mutateAsync(source);
      await runPipeline(res.import_id, res.source_filename);
    } catch (e: any) {
      setStage({
        kind: "error",
        from: "upload",
        errorCode: e?.code ?? "upload_failed",
        message: e?.message,
      });
    }
  };

  /** Avbryter analysen server-side. Import, fil og grunnlag beholdes. */
  const onCancelAnalysis = async (importId: string, fileName: string, jobId: string) => {
    setCancelling(true);
    const res = await cancelAtomizationJob(jobId);
    setCancelling(false);
    follow.current?.abort();
    if ("error" in res) {
      toast.error(`Vi fikk ikke stoppet analysen: ${res.error.message}`);
      return;
    }
    toast.success("Analysen er stoppet. Det som allerede er analysert er beholdt.");
    setStage({
      kind: "summary",
      importId,
      fileName,
      jobId,
      outcome: {
        status: "cancelled",
        proposalsCreated: 0,
        failedBlocks: [],
        unfinishedBlocks: blocks
          .filter((b) => b.status === "queued" || b.status === "running" || b.status === "failed")
          .map((b) => ({ label: b.label, status: b.status })),
        blocks,
      },
      counts,
      commit: null,
    });
  };

  const onResumeAnalysis = async (importId: string, fileName: string, jobId: string) => {
    const res = await resumeAtomizationJob(jobId);
    if ("error" in res) {
      toast.error(`Vi fikk ikke startet analysen igjen: ${res.error.message}`);
      return;
    }
    await watchJob(importId, fileName, jobId, counts);
  };

  const onDiscardImport = async (importId: string) => {
    try {
      await cancelImport(importId);
    } catch (e: any) {
      toast.error(`Vi fikk ikke avbrutt importen: ${e?.message ?? "ukjent årsak"}.`);
    }
    setStage({ kind: "idle" });
  };

  const onCreateDocumentationDrafts = async (importId: string) => {
    try {
      const res = await docDrafts.mutateAsync(importId);
      if (res.results_created === 0) {
        toast.info(
          res.skipped_existing > 0
            ? "Alle resultatpunktene lå allerede som utkast under Min dokumentasjon."
            : "Vi fant ingen resultatpunkter å lage utkast av i denne CV-en.",
        );
        return;
      }
      toast.success(
        `${res.results_created} resultatutkast opprettet under Min dokumentasjon${
          res.skipped_existing > 0 ? ` (${res.skipped_existing} fantes fra før)` : ""
        }.`,
      );
    } catch (e: any) {
      toast.error(`Kunne ikke lage utkast i Min dokumentasjon: ${e?.message ?? "ukjent årsak"}.`);
    }
  };

  const busy =
    stage.kind === "uploading" ||
    stage.kind === "parsing" ||
    stage.kind === "preparing" ||
    stage.kind === "analyzing";

  return (
    <Card>
      <CardHeader>
        <CardTitle className={compact ? "text-base" : undefined}>
          Bygg karriereoversikt fra CV
        </CardTitle>
        <CardDescription>
          Last opp PDF eller DOCX. Analysen starter av seg selv når opplastingen er ferdig, og
          etterpå går du gjennom innholdet i fire trinn. Ingenting lagres i karriereoversikten før
          du har bekreftet det.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stage.kind === "idle" && (
          <div className="space-y-4">
            <ArchiveCvPicker
              userId={userId}
              busy={importArchived.isPending}
              onUse={(source) => void onUseArchived(source)}
            />
            <CvDropzone
              onFile={(file, error) => {
                if (error) {
                  toast.error(messageFor(error));
                  return;
                }
                void onFileSelected(file);
              }}
            />
          </div>
        )}

        {busy && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{STAGE_LABEL[stage.kind]}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {"fileName" in stage ? stage.fileName : ""}
                </p>
              </div>
            </div>

            {stage.kind === "analyzing" && blocks.length > 0 && (
              <div className="space-y-2">
                <Progress value={jobProgressPercent(blocks)} />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {blocks.map((b) => (
                    <li key={b.block_key} className="flex items-center gap-2">
                      {b.status === "complete" || b.status === "needs_review" ? (
                        <CheckCircle2 className="h-3 w-3 text-primary" />
                      ) : b.status === "failed" ? (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      ) : b.status === "running" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full border" />
                      )}
                      <span className="truncate">{b.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Du kan forlate siden — analysen fortsetter, og du kommer tilbake hit til samme sted.
            </p>

            {stage.kind === "analyzing" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={cancelling}
                onClick={() => void onCancelAnalysis(stage.importId, stage.fileName, stage.jobId)}
              >
                {cancelling ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-1 h-4 w-4" />
                )}
                Avbryt analysen
              </Button>
            )}
          </div>
        )}

        {stage.kind === "summary" && (
          <SummaryView
            stage={stage}
            counts={counts}
            docsPending={docDrafts.isPending}
            onResume={() =>
              stage.jobId
                ? void onResumeAnalysis(stage.importId, stage.fileName, stage.jobId)
                : undefined
            }
            onCreateDrafts={() => void onCreateDocumentationDrafts(stage.importId)}
            onReset={() => setStage({ kind: "idle" })}
          />
        )}

        {stage.kind === "error" && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Vi kom ikke i mål</AlertTitle>
              <AlertDescription>{messageFor(stage.errorCode, stage.message)}</AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              {stage.importId && (
                <Button
                  size="sm"
                  onClick={() => void runPipeline(stage.importId!, stage.fileName ?? "CV")}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Prøv analysen på nytt
                </Button>
              )}
              {stage.importId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onDiscardImport(stage.importId!)}
                >
                  Avbryt importen
                </Button>
              )}
              {!stage.importId && (
                <Button variant="outline" size="sm" onClick={() => setStage({ kind: "idle" })}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Prøv igjen
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryView({
  stage,
  counts,
  docsPending,
  onResume,
  onCreateDrafts,
  onReset,
}: {
  stage: Extract<Stage, { kind: "summary" }>;
  counts: PreviewCounts | null;
  docsPending: boolean;
  onResume: () => void;
  onCreateDrafts: () => void;
  onReset: () => void;
}) {
  const outcome = stage.outcome;
  const unfinished = outcome?.unfinishedBlocks ?? [];
  const partial = outcome?.status === "partial" || outcome?.status === "cancelled" || unfinished.length > 0;

  return (
    <div className="space-y-3">
      <Alert variant={partial ? "destructive" : "default"}>
        {partial ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        <AlertTitle>
          {outcome?.status === "cancelled"
            ? "Analysen ble stoppet"
            : partial
              ? "Analysen ble bare delvis ferdig"
              : "Analysen er ferdig"}
        </AlertTitle>
        <AlertDescription className="space-y-1">
          <span className="block">
            Vi fant {counts?.experience ?? 0} roller,{" "}
            {(counts?.experienceBullets ?? 0) + (counts?.achievements ?? 0)} resultater og{" "}
            {counts?.skills ?? 0} kompetanser.
          </span>
          {unfinished.length > 0 && (
            <span className="block">
              Disse delene mangler fortsatt: {unfinished.map((b) => b.label).join(", ")}. Trinn 1–4
              bygger bare på det som faktisk er analysert.
            </span>
          )}
          <span className="block">
            Ingenting er lagt i karriereoversikten ennå — du bekrefter innholdet i en gjennomgang på
            fire trinn.
          </span>
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/career/cv-review" search={{ import: stage.importId }}>
            Gå gjennom nå
          </Link>
        </Button>
        {unfinished.length > 0 && stage.jobId && (
          <Button variant="outline" size="sm" onClick={onResume}>
            <RotateCcw className="mr-2 h-4 w-4" /> Fullfør resten av analysen
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onReset}>
          Senere
        </Button>
        <Button variant="outline" size="sm" disabled={docsPending} onClick={onCreateDrafts}>
          {docsPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Lag utkast i Min dokumentasjon
        </Button>
        <Button variant="outline" size="sm" onClick={onReset}>
          <FileText className="mr-2 h-4 w-4" /> Last opp en til
        </Button>
      </div>
    </div>
  );
}
