import { useReducer, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, FileText, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { CvDropzone } from "./dropzone";
import { ArchiveCvPicker } from "./archive-picker";
import { PreviewSummary } from "./preview-summary";
import { PreviewDetails } from "./preview-details";
import { buildPreviewGroups, filterParsedData, flattenItems } from "@/lib/cv-preview-items";
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
import { Link, useNavigate } from "@tanstack/react-router";
import { useCreateDocumentationDrafts } from "@/lib/queries/cv-documentation-drafts";
import { supabase } from "@/lib/supabase";
import type { CommitResponse, FlowState, PreviewCounts } from "@/types/cv-upload";

type Action =
  | { type: "select"; file: File }
  | { type: "upload_start" }
  | { type: "upload_done"; importId: string; fileName: string }
  | { type: "parse_start"; importId: string; fileName: string }
  | { type: "parse_failed"; message: string }
  | { type: "parsed"; importId: string; counts: PreviewCounts; fileName: string; raw: any }
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
      // Gjelder både filopplasting ("uploading") og valg fra CV-arkivet ("idle").
      return state.kind === "uploading" || state.kind === "idle"
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
        raw: action.raw,
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
  const navigate = useNavigate();
  const commit = useCommitImport(userId);
  const importArchived = useImportArchivedCv(userId);
  const docDrafts = useCreateDocumentationDrafts(userId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      toast.error(
        `Kunne ikke lage utkast i Min dokumentasjon: ${e?.message ?? "ukjent årsak"}.`,
      );
    }
  };

  const toggleSelected = (key: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const setManySelected = (keys: string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const onUseArchived = async (source: ArchivedCvSource) => {
    try {
      const res = await importArchived.mutateAsync(source);
      dispatch({
        type: "upload_done",
        importId: res.import_id,
        fileName: res.source_filename,
      });
      // Brukeren har allerede valgt filen — analysen starter uten et ekstra trykk.
      await runAnalyze(res.import_id, res.source_filename);
    } catch (e: any) {
      dispatch({
        type: "error",
        from: "upload",
        errorCode: e?.code ?? "upload_failed",
        message: e?.message,
      });
    }
  };

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

  const runAnalyze = async (importId: string, fileName: string) => {
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
          message: error
            ? `Kunne ikke hente analyseresultat fra databasen: ${error.message}`
            : "Analysen lagret ingen data for denne filen.",
        });
        return;
      }
      if (!parsedShapeIsReadable(row.raw_parsed_data)) {
        // Uleselig svar ga tidligere «0 elementer funnet», som så ut som en tom CV.
        dispatch({
          type: "parse_failed",
          message:
            "Vi fikk et svar vi ikke klarte å lese. Dette er ikke det samme som at CV-en er tom — prøv analysen på nytt.",
        });
        return;
      }
      const counts = countsFromParsed(row.raw_parsed_data);
      dispatch({
        type: "parsed",
        importId: res.import_id,
        counts,
        fileName: (row.source_filename as string) ?? fileName,
        raw: row.raw_parsed_data,
      });
      setSelected(new Set(flattenItems(buildPreviewGroups(row.raw_parsed_data)).map((i) => i.key)));
    } catch (e: any) {
      dispatch({
        type: "parse_failed",
        message: e?.message ?? "Analyse feilet.",
      });
    }
  };

  const onCommit = async (importId: string, raw: any) => {
    dispatch({ type: "commit_start", importId });
    try {
      // Bare det brukeren har huket av skal lagres. Vi skriver det valgte
      // utvalget tilbake til import-raden, slik at commit-funksjonen
      // konverterer nøyaktig det brukeren bekreftet.
      const filtered = filterParsedData(raw, selected);
      const { error: updErr } = await (supabase.from("cv_imports") as any)
        .update({ raw_parsed_data: filtered })
        .eq("id", importId);
      if (updErr) throw Object.assign(new Error(updErr.message), { code: "database_error" });
      const result = await commit.mutateAsync(importId);
      dispatch({ type: "done", result });
      toast.success(`${result.candidates_created} elementer lagret. Vi tar deg rett til gjennomgangen.`);
      onCompleted?.(result);
      // Direkte oppstart: brukeren skal ikke måtte lete etter neste steg.
      if (!onCompleted) {
        void navigate({ to: "/career/cv-review", search: { import: result.import_id } });
      }
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
    } catch (e: any) {
      // Avbrytelsen feilet: raden blir liggende og dukker opp igjen i listen.
      toast.error(
        `Vi fikk ikke avbrutt importen: ${e?.message ?? "ukjent årsak"}. Den kan fortsatt ligge i listen.`,
      );
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
                dispatch({ type: "select", file });
              }}
            />
          </div>
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
              <Button onClick={() => void runAnalyze(state.importId, state.fileName)} disabled={runParse.isPending}>
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
            <PreviewDetails
              userId={userId}
              raw={state.raw}
              selected={selected}
              onToggle={toggleSelected}
              onSetMany={setManySelected}
            />
            <div className="flex gap-2">
              <Button onClick={() => onCommit(state.importId, state.raw)} disabled={commit.isPending || selected.size === 0}>
                {commit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Bekreft og lagre{selected.size > 0 ? ` (${selected.size})` : ""}
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
              <AlertTitle>Innholdet er lagret og klart for gjennomgang</AlertTitle>
              <AlertDescription className="space-y-1">
                <span className="block">
                  {state.result.candidates_created} elementer ble lagret fra denne CV-en
                  {state.result.candidates_duplicate_skipped > 0 &&
                    ` (${state.result.candidates_duplicate_skipped} var allerede lagret fra før)`}
                  . Til sammen ligger det {state.result.candidates_total_in_import} elementer i denne
                  importen, hvorav {state.result.roles} stillinger og{" "}
                  {state.result.children_with_parent} punkter som hører til en stilling.
                </span>
                <span className="block">
                  Ingenting er lagt i karriereoversikten ennå — du bekrefter hvert element i
                  gjennomgangen. Derfor står telleren over fortsatt på det du har bekreftet tidligere.
                </span>
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/career/cv-review">Gå til gjennomgang</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={docDrafts.isPending}
                onClick={() => void onCreateDocumentationDrafts(state.result.import_id)}
              >
                {docDrafts.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Lag utkast i Min dokumentasjon
              </Button>
              <Button variant="outline" size="sm" onClick={() => dispatch({ type: "reset" })}>
                <RotateCcw className="h-4 w-4 mr-2" /> Last opp en til
              </Button>
            </div>
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
