import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import {
  documentationLibraryDocumentsQuery,
  documentationQueryKeys,
  deleteCaseDocument,
  insertCaseDocument,
  insertProfessionalCase,
  insertProfessionalResult,
  professionalCaseDocumentsQuery,
  professionalCasesListQuery,
  professionalResultsListQuery,
} from "@/lib/queries/documentation";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export const Route = createFileRoute("/_authenticated/documentation/cases")({
  component: DocumentationCasesPage,
});

type CaseRow = {
  id: string;
  title: string;
  summary: string | null;
  company_name: string | null;
  updated_at: string | null;
};

type ResultRow = {
  id: string;
  title: string;
  description: string | null;
  metric_name: string | null;
  metric_value: string | null;
  time_period: string | null;
  updated_at: string | null;
};

type LibraryDocumentRow = {
  id: string;
  title: string | null;
  document_type: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type CaseDocumentRow = {
  id: string;
  case_id: string;
  document_id: string;
  documents?: {
    id: string;
    title: string | null;
    document_type: string | null;
    updated_at: string | null;
  } | null;
};

function nullIfEmpty(s: string) {
  const t = s.trim();
  return t.length ? t : null;
}

function DocumentationCasesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const casesQuery = useQuery(professionalCasesListQuery());
  const resultsQuery = useQuery(professionalResultsListQuery());
  const caseDocsQuery = useQuery(professionalCaseDocumentsQuery());
  const documentsQuery = useQuery(documentationLibraryDocumentsQuery());

  const [caseTitle, setCaseTitle] = useState("");
  const [caseSummary, setCaseSummary] = useState("");
  const [caseSituation, setCaseSituation] = useState("");
  const [caseResponsibility, setCaseResponsibility] = useState("");
  const [caseActions, setCaseActions] = useState("");
  const [caseResults, setCaseResults] = useState("");

  const [resTitle, setResTitle] = useState("");
  const [resDescription, setResDescription] = useState("");
  const [resMetricName, setResMetricName] = useState("");
  const [resMetricValue, setResMetricValue] = useState("");
  const [resTimePeriod, setResTimePeriod] = useState("");
  const [pickerCaseId, setPickerCaseId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const createCaseMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Ikke innlogget");
      const title = caseTitle.trim();
      if (!title) throw new Error("Tittel er påkrevd");
      return insertProfessionalCase({
        user_id: user.id,
        title,
        summary: nullIfEmpty(caseSummary),
        situation: nullIfEmpty(caseSituation),
        responsibility: nullIfEmpty(caseResponsibility),
        actions_taken: nullIfEmpty(caseActions),
        results: nullIfEmpty(caseResults),
      });
    },
    onSuccess: () => {
      toast.success("Case opprettet");
      setCaseTitle("");
      setCaseSummary("");
      setCaseSituation("");
      setCaseResponsibility("");
      setCaseActions("");
      setCaseResults("");
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.professionalCases });
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.overviewCounts });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke opprette case"),
  });

  const createResultMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Ikke innlogget");
      const title = resTitle.trim();
      if (!title) throw new Error("Tittel er påkrevd");
      return insertProfessionalResult({
        user_id: user.id,
        title,
        description: nullIfEmpty(resDescription),
        metric_name: nullIfEmpty(resMetricName),
        metric_value: nullIfEmpty(resMetricValue),
        time_period: nullIfEmpty(resTimePeriod),
      });
    },
    onSuccess: () => {
      toast.success("Resultat opprettet");
      setResTitle("");
      setResDescription("");
      setResMetricName("");
      setResMetricValue("");
      setResTimePeriod("");
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.professionalResults });
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.overviewCounts });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke opprette resultat"),
  });

  const linkDocumentMut = useMutation({
    mutationFn: async (args: { caseId: string; documentId: string }) => {
      if (!user) throw new Error("Ikke innlogget");
      return insertCaseDocument({
        user_id: user.id,
        case_id: args.caseId,
        document_id: args.documentId,
      });
    },
    onSuccess: () => {
      toast.success("Dokument koblet");
      setPickerSearch("");
      setPickerCaseId(null);
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.professionalCaseDocuments });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke koble dokument"),
  });

  const unlinkDocumentMut = useMutation({
    mutationFn: async (caseDocumentId: string) => deleteCaseDocument(caseDocumentId),
    onSuccess: () => {
      toast.success("Kobling fjernet");
      void qc.invalidateQueries({ queryKey: documentationQueryKeys.professionalCaseDocuments });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke fjerne kobling"),
  });

  const cases = (casesQuery.data ?? []) as CaseRow[];
  const results = (resultsQuery.data ?? []) as ResultRow[];
  const caseDocuments = (caseDocsQuery.data ?? []) as CaseDocumentRow[];
  const documents = (documentsQuery.data ?? []) as LibraryDocumentRow[];

  return (
    <DocumentationLayout>
      <div className="space-y-8">
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profesjonelle case</CardTitle>
              <CardDescription>Tittel, sammendrag, selskap og sist oppdatert.</CardDescription>
            </CardHeader>
            <CardContent>
              {casesQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : casesQuery.isError ? (
                <p className="text-sm text-destructive">
                  {(casesQuery.error as Error)?.message ?? "Kunne ikke laste case."}
                </p>
              ) : !cases.length ? (
                <EmptyState
                  title="Ingen case ennå"
                  description="Legg til din første case med skjemaet under."
                />
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {cases.map((c) => (
                    <li key={c.id} className="space-y-3 px-3 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{c.title}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtDate(c.updated_at)}
                        </span>
                      </div>
                      {c.summary ? (
                        <p className="text-muted-foreground whitespace-pre-wrap">{c.summary}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Selskap: {c.company_name?.trim() ? c.company_name : "—"}
                      </p>

                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground">Knyttede dokumenter</p>
                          <Popover
                            open={pickerCaseId === c.id}
                            onOpenChange={(open) => {
                              setPickerCaseId(open ? c.id : null);
                              if (!open) setPickerSearch("");
                            }}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={documentsQuery.isLoading || !user}
                              >
                                Koble dokument
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[340px] p-0" align="end">
                              <Command>
                                <CommandInput
                                  value={pickerSearch}
                                  onValueChange={setPickerSearch}
                                  placeholder="Søk etter dokument..."
                                />
                                <CommandList>
                                  {documentsQuery.isLoading ? (
                                    <div className="py-4 text-center text-xs text-muted-foreground">
                                      Laster dokumenter...
                                    </div>
                                  ) : (
                                    <>
                                      <CommandEmpty>Ingen dokumenter tilgjengelig.</CommandEmpty>
                                      <CommandGroup heading="Dine dokumenter">
                                        {documents
                                          .filter((d) => {
                                            const linkedDocIds = new Set(
                                              caseDocuments
                                                .filter((cd) => cd.case_id === c.id)
                                                .map((cd) => cd.document_id),
                                            );
                                            if (linkedDocIds.has(d.id)) return false;
                                            const q = pickerSearch.trim().toLowerCase();
                                            if (!q) return true;
                                            const inTitle = (d.title ?? "")
                                              .toLowerCase()
                                              .includes(q);
                                            const inType = (d.document_type ?? "")
                                              .toLowerCase()
                                              .includes(q);
                                            return inTitle || inType;
                                          })
                                          .map((d) => (
                                            <CommandItem
                                              key={d.id}
                                              value={`${d.title ?? ""} ${d.document_type ?? ""}`}
                                              onSelect={() => {
                                                linkDocumentMut.mutate({
                                                  caseId: c.id,
                                                  documentId: d.id,
                                                });
                                              }}
                                            >
                                              <div className="min-w-0">
                                                <p className="truncate">
                                                  {d.title?.trim() || "Uten tittel"}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                  {d.document_type?.trim() || "—"} ·{" "}
                                                  {fmtDate(d.updated_at ?? d.created_at)}
                                                </p>
                                              </div>
                                            </CommandItem>
                                          ))}
                                      </CommandGroup>
                                    </>
                                  )}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>

                        {caseDocsQuery.isLoading ? (
                          <Skeleton className="h-14 w-full" />
                        ) : (
                          (() => {
                            const linked = caseDocuments.filter(
                              (cd) => cd.case_id === c.id && cd.documents?.id,
                            );
                            if (!linked.length) {
                              return (
                                <EmptyState
                                  title="Ingen knyttede dokumenter"
                                  description="Koble et dokument for å bygge case-grunnlag."
                                />
                              );
                            }
                            return (
                              <ul className="divide-y rounded-md border bg-background">
                                {linked.map((cd) => (
                                  <li
                                    key={cd.id}
                                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                  >
                                    <Link
                                      to="/documents/$id"
                                      params={{ id: cd.documents!.id }}
                                      className="min-w-0 flex-1 hover:underline"
                                    >
                                      <p className="truncate text-sm font-medium">
                                        {cd.documents?.title?.trim() || "Uten tittel"}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {cd.documents?.document_type?.trim() || "—"} ·{" "}
                                        {fmtDate(cd.documents?.updated_at)}
                                      </p>
                                    </Link>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={unlinkDocumentMut.isPending}
                                      onClick={() => unlinkDocumentMut.mutate(cd.id)}
                                    >
                                      Fjern
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            );
                          })()
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ny case</CardTitle>
              <CardDescription>
                Fyll ut det du vil dokumentere nå; du kan utvide senere.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4 max-w-2xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  createCaseMut.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="case-title">Tittel</Label>
                  <Input
                    id="case-title"
                    value={caseTitle}
                    onChange={(e) => setCaseTitle(e.target.value)}
                    placeholder="F.eks. digital transformasjon i retail"
                    disabled={createCaseMut.isPending}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-summary">Sammendrag</Label>
                  <Textarea
                    id="case-summary"
                    value={caseSummary}
                    onChange={(e) => setCaseSummary(e.target.value)}
                    rows={3}
                    disabled={createCaseMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-situation">Situasjon</Label>
                  <Textarea
                    id="case-situation"
                    value={caseSituation}
                    onChange={(e) => setCaseSituation(e.target.value)}
                    rows={3}
                    disabled={createCaseMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-responsibility">Ansvar</Label>
                  <Textarea
                    id="case-responsibility"
                    value={caseResponsibility}
                    onChange={(e) => setCaseResponsibility(e.target.value)}
                    rows={3}
                    disabled={createCaseMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-actions">Tiltak</Label>
                  <Textarea
                    id="case-actions"
                    value={caseActions}
                    onChange={(e) => setCaseActions(e.target.value)}
                    rows={3}
                    disabled={createCaseMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="case-results">Resultater (tekst)</Label>
                  <Textarea
                    id="case-results"
                    value={caseResults}
                    onChange={(e) => setCaseResults(e.target.value)}
                    rows={3}
                    disabled={createCaseMut.isPending}
                  />
                </div>
                <Button type="submit" disabled={createCaseMut.isPending || !user}>
                  {createCaseMut.isPending ? "Lagrer…" : "Opprett case"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultater</CardTitle>
              <CardDescription>Målinger og utfall du vil vise frem.</CardDescription>
            </CardHeader>
            <CardContent>
              {resultsQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : resultsQuery.isError ? (
                <p className="text-sm text-destructive">
                  {(resultsQuery.error as Error)?.message ?? "Kunne ikke laste resultater."}
                </p>
              ) : !results.length ? (
                <EmptyState
                  title="Ingen resultater ennå"
                  description="Registrer et resultat med skjemaet under."
                />
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {results.map((r) => (
                    <li key={r.id} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{r.title}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtDate(r.updated_at)}
                        </span>
                      </div>
                      {r.description ? (
                        <p className="text-muted-foreground whitespace-pre-wrap">{r.description}</p>
                      ) : null}
                      <dl className="grid gap-1 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="text-muted-foreground">Målnavn</dt>
                          <dd>{r.metric_name?.trim() ? r.metric_name : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Verdi</dt>
                          <dd>{r.metric_value?.trim() ? r.metric_value : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Periode</dt>
                          <dd>{r.time_period?.trim() ? r.time_period : "—"}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nytt resultat</CardTitle>
              <CardDescription>KPI eller konkret effekt av arbeidet ditt.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4 max-w-2xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  createResultMut.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="res-title">Tittel</Label>
                  <Input
                    id="res-title"
                    value={resTitle}
                    onChange={(e) => setResTitle(e.target.value)}
                    placeholder="F.eks. kortere leveransetid"
                    disabled={createResultMut.isPending}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="res-description">Beskrivelse</Label>
                  <Textarea
                    id="res-description"
                    value={resDescription}
                    onChange={(e) => setResDescription(e.target.value)}
                    rows={3}
                    disabled={createResultMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="res-metric-name">Målnavn</Label>
                  <Input
                    id="res-metric-name"
                    value={resMetricName}
                    onChange={(e) => setResMetricName(e.target.value)}
                    placeholder="F.eks. konverteringsrate"
                    disabled={createResultMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="res-metric-value">Målverdi</Label>
                  <Input
                    id="res-metric-value"
                    value={resMetricValue}
                    onChange={(e) => setResMetricValue(e.target.value)}
                    placeholder="F.eks. +12 %"
                    disabled={createResultMut.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="res-time-period">Tidsperiode</Label>
                  <Input
                    id="res-time-period"
                    value={resTimePeriod}
                    onChange={(e) => setResTimePeriod(e.target.value)}
                    placeholder="F.eks. Q1 2025"
                    disabled={createResultMut.isPending}
                  />
                </div>
                <Button type="submit" disabled={createResultMut.isPending || !user}>
                  {createResultMut.isPending ? "Lagrer…" : "Opprett resultat"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </DocumentationLayout>
  );
}
