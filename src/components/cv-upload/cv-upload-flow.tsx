import { useReducer, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, FileText, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { CvDropzone } from "./dropzone";
import { PreviewSummary } from "./preview-summary";
import { messageFor } from "./error-messages";
import {
  cancelImport,
  countsFromParsed,
  useCommitImport,
  useRegisterCvUpload,
  useRunCvParse,
} from "@/lib/queries/cv-imports";
import { supabase } from "@/integrations/supabase/client";
import type { CommitResponse, FlowState } from "@/types/cv-upload";

type Action =
  | { type: "select"; file: File }
  | { type: "upload_start" }
  | { type: "upload_done"; importId: string; fileName: string }
  | { type: "parse_start"; importId: string; fileName: string }
  | { type: "parse_failed"; message: string }
  | { type: "parsed"; importId: string; counts: PreviewCounts; fileName: string }
  | { type: "commit_start"; importId: string }
  | { type: "done"; result: CommitResponse }
  | { type: "error"; from: "upload" | "parse" | "commit"; errorCode: string; message?: string; importId?: string }
  | { type: "reset" };

function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case "select":
      return { kind: "file_selected", file: action.file };
    case "upload_start":
      return state.kind === "file_selected"
        ? { kind: "uploading", file: state.file }
        : state;
    case "upload_done":
      return state.kind === "uploading"
        ? { kind: "await_parse", importId: action.importId, fileName: action.fileName }
        : state;
    case "parse_start":
      return state.kind === "await_parse" && state.importId === action.importId
        ? { kind: "parsing", importId: action.importId, fileName: action.fileName }
        : state;
    case "parse_failed":
      return state.kind === "parsing"
        ? {
            kind: "await_parse",
            importId: state.importId,
            fileName: state.fileName,
            lastError: action.message,
          }
        : state;
    case "parsed":
      return {
        kind: "parsed_preview",
        importId: action.importId,
        counts: action.counts,
        fileName: action.fileName,
      };
    case "commit_start":
      return { kind: "committing", importId: action.importId };
    case "done":
      return { kind: "done", result: action.result };
    case "error":
      return {
        kind: "error",
        from: action.from,
        errorCode: action.errorCode,
        message: action.message,
        importId: action.importId,
      };
    case "reset":
      return { kind: "idle" };
    default:
      return state;
  }
}

interface Props {
  userId: string;
  onCompleted?: (result: CommitResponse) => void;
  /** Compact variant for onboarding step */
  compact?: boolean;
}

export function CvUploadFlow({ userId, onCompleted, compact }: Props) {
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as FlowState);
  const register = useRegisterCvUpload(userId);
  const runParse = useRunCvParse(userId);
  const commit = useCommitImport(userId);

  useEffect(() => {
    if (state.kind !== "file_selected") return;
    const file = state.file;
    let cancelled = false;
    (async () => {
      dispatch({ type: "upload_start" });
      try {
        const res = await register.mutateAsync(file);
        if (cancelled) return;
        dispatch({
          type: "upload_done",
          importId: res.import_id,
          fileName: res.source_filename,
        });
      } catch (e: any) {
        if (cancelled) return;
        const code = e?.code ?? "upload_failed";
        const from = code === "upload_failed" ? "upload" : "parse";
        dispatch({ type: "error", from, errorCode: code, message: e?.message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === "file_selected" ? (state as { file: File }).file : null]);

  const runAnalyze = async () => {
    if (state.kind !== "await_parse") return;
    const { importId, fileName } = state;
    dispatch({ type: "parse_start", importId, fileName });
    try {
      const res = await runParse.mutateAsync(importId);
      const { data: row, error } = await supabase
        .from("cv_imports")
        .select("raw_parsed_data, source_filename")
        .eq("id", res.import_id)
        .maybeSingle();
      if (error || !row?.raw_parsed_data) {
        dispatch({
          type: "parse_failed",
          message: "Kunne ikke hente analyseresultat fra databasen.",
        });
        return;
      }
      const counts = countsFromParsed(row.raw_parsed_data);
      dispatch({
        type: "parsed",
        importId: res.import_id,
        counts,
        fileName: (row.source_filename as string) ?? fileName,
      });
    } catch (e: any) {
      dispatch({
        type: "parse_failed",
        message: e?.message ?? "Analyse feilet.",
      });
    }
  };

  const onCommit = async (importId: string) => {
    dispatch({ type: "commit_start", importId });
    try {
      const result = await commit.mutateAsync(importId);
      dispatch({ type: "done", result });
      toast.success(`Karriereoversikten er oppdatert. ${result.atoms_total_now} elementer totalt.`);
      onCompleted?.(result);
    } catch (e: any) {
      dispatch({
        type: "error",
        from: "commit",
        errorCode: e?.code ?? "database_error",
        message: e?.message,
        importId,
      });
    }
  };

  const onCancelAwaitOrPreview = async (importId: string) => {
    try {
      await cancelImport(importId);
    } catch {
      /* best effort */
    }
    dispatch({ type: "reset" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className={compact ? "text-base" : undefined}>
          Bygg karriereoversikt fra CV
        </CardTitle>
        <CardDescription>
          Steg 1: Last opp PDF eller DOCX (går raskt). Steg 2: Trykk «Analyser CV» når du er klar —
          da kjøres AI-tolkning og kan ta et minutt. Steg 3: Gå gjennom forhåndsvisning og trykk
          «Bekreft og lagre» for å legge data inn i karriereoversikten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === "idle" && (
          <CvDropzone
            onFile={(file, error) => {
              if (error) {
                toast.error(messageFor(error));
                return;
              }
              dispatch({ type: "select", file });
            }}
          />
        )}

        {(state.kind === "file_selected" || state.kind === "uploading") && (
          <div className="flex items-center gap-3 rounded-md border p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Laster opp til sikker lagring…</p>
              <p className="text-xs text-muted-foreground truncate">
                {(state as { file: File }).file?.name}
              </p>
            </div>
          </div>
        )}

        {state.kind === "parsing" && (
          <div className="flex items-center gap-3 rounded-md border p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Analyserer innhold med AI…</p>
              <p className="text-xs text-muted-foreground truncate">{state.fileName}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Du kan forlate siden — import-raden oppdateres når analysen er ferdig. Kom tilbake og
                trykk «Analyser CV» igjen bare hvis status fortsatt er «venter» etter lang tid.
              </p>
            </div>
          </div>
        )}

        {state.kind === "await_parse" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate font-medium text-foreground">{state.fileName}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Filen er lastet opp. Start AI-analyse når du vil — den blokkerer ikke opplastingen.
            </p>
            {state.lastError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analyse feilet</AlertTitle>
                <AlertDescription>{state.lastError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runAnalyze()} disabled={runParse.isPending}>
                {runParse.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Analyser CV
              </Button>
              <Button
                variant="ghost"
                onClick={() => void onCancelAwaitOrPreview(state.importId)}
                disabled={runParse.isPending}
              >
                <X className="h-4 w-4 mr-1" /> Avbryt
              </Button>
            </div>
          </div>
        )}

        {state.kind === "parsed_preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="truncate">{state.fileName}</span>
            </div>
            <PreviewSummary counts={state.counts} />
            <div className="flex gap-2">
              <Button onClick={() => onCommit(state.importId)} disabled={commit.isPending}>
                {commit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Bekreft og lagre
              </Button>
              <Button
                variant="ghost"
                onClick={() => void onCancelAwaitOrPreview(state.importId)}
                disabled={commit.isPending}
              >
                <X className="h-4 w-4 mr-1" /> Avbryt
              </Button>
            </div>
          </div>
        )}

        {state.kind === "committing" && (
          <div className="flex items-center gap-3 rounded-md border p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-medium">Lagrer i karriereoversikten…</p>
          </div>
        )}

        {state.kind === "done" && (
          <div className="space-y-3">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Karriereoversikten er oppdatert</AlertTitle>
              <AlertDescription>
                {state.result.atoms_created} nye elementer lagt til.
                {state.result.atoms_merged > 0 &&
                  ` ${state.result.atoms_merged} eksisterende ble oppdatert.`}{" "}
                Totalt {state.result.atoms_total_now} elementer.
              </AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "reset" })}>
              <RotateCcw className="h-4 w-4 mr-2" /> Last opp en til
            </Button>
          </div>
        )}

        {state.kind === "error" && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Opplastingen feilet</AlertTitle>
              <AlertDescription>
                {messageFor(state.errorCode, state.message)}
              </AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "reset" })}>
              <RotateCcw className="h-4 w-4 mr-2" /> Prøv igjen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
