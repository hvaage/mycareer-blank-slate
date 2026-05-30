import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { documentationLibraryDocumentsQuery } from "@/lib/queries/documentation";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/documentation/library")({
  component: DocumentationLibraryPage,
});

type LibraryDocRow = {
  id: string;
  title: string;
  document_type: string;
  updated_at: string | null;
  created_at: string | null;
  documentation_category?: string | null;
  documentation_status?: string | null;
  visibility?: string | null;
  applications?: { company_name: string | null; role_title: string | null } | null;
};

const ALL = "__all__";
const CAT_NONE = "__cat_none__";
const STATUS_NONE = "__status_none__";
const VIS_NONE = "__vis_none__";

function isBlank(v: string | null | undefined) {
  return v == null || String(v).trim() === "";
}

function uniqueSorted(values: (string | null | undefined)[]) {
  const set = new Set<string>();
  for (const v of values) {
    if (!isBlank(v)) set.add(String(v).trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "nb"));
}

function labelCategory(d: LibraryDocRow) {
  return isBlank(d.documentation_category) ? "Ikke kategorisert" : String(d.documentation_category).trim();
}

function labelStatus(d: LibraryDocRow) {
  return isBlank(d.documentation_status) ? "Aktiv" : String(d.documentation_status).trim();
}

function labelVisibility(d: LibraryDocRow) {
  return isBlank(d.visibility) ? "Privat" : String(d.visibility).trim();
}

function matchesCategoryFilter(d: LibraryDocRow, category: string) {
  if (category === ALL) return true;
  if (category === CAT_NONE) return isBlank(d.documentation_category);
  return String(d.documentation_category ?? "").trim() === category;
}

function matchesStatusFilter(d: LibraryDocRow, status: string) {
  if (status === ALL) return true;
  if (status === STATUS_NONE) return isBlank(d.documentation_status);
  return String(d.documentation_status ?? "").trim() === status;
}

function matchesVisibilityFilter(d: LibraryDocRow, vis: string) {
  if (vis === ALL) return true;
  if (vis === VIS_NONE) return isBlank(d.visibility);
  return String(d.visibility ?? "").trim() === vis;
}

function DocumentationLibraryPage() {
  const { data, isLoading, isError, error } = useQuery(documentationLibraryDocumentsQuery());
  const rows = (data ?? []) as LibraryDocRow[];

  const [titleQuery, setTitleQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [visibility, setVisibility] = useState(ALL);

  const categoryValues = useMemo(() => uniqueSorted(rows.map((r) => r.documentation_category)), [rows]);
  const statusValues = useMemo(() => uniqueSorted(rows.map((r) => r.documentation_status)), [rows]);
  const visibilityValues = useMemo(() => uniqueSorted(rows.map((r) => r.visibility)), [rows]);

  const filtered = useMemo(() => {
    const q = titleQuery.trim().toLowerCase();
    return rows.filter((d) => {
      if (q && !d.title.toLowerCase().includes(q)) return false;
      if (!matchesCategoryFilter(d, category)) return false;
      if (!matchesStatusFilter(d, status)) return false;
      if (!matchesVisibilityFilter(d, visibility)) return false;
      return true;
    });
  }, [rows, titleQuery, category, status, visibility]);

  const hasActiveFilters =
    titleQuery.trim() !== "" || category !== ALL || status !== ALL || visibility !== ALL;

  return (
    <DocumentationLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dokumentbibliotek</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Alle dokumenter som ikke er markert som slettet (samme utvalg som i oversiktstallet for
            dokumenter). Åpne redigering i eksisterende flyt via «Åpne» eller raden.
          </p>

          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : isError ? (
            <p className="text-sm text-destructive">{(error as Error)?.message ?? "Kunne ikke laste dokumenter."}</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Ingen dokumenter i biblioteket"
              description="Når du har dokumenter uten slettet-dato, vises de her—samme som dokumenttelleren på oversikten."
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2 sm:col-span-2 lg:col-span-2">
                  <Label htmlFor="doc-lib-search" className="text-xs text-muted-foreground">
                    Søk i tittel
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="doc-lib-search"
                      placeholder="Filtrer listen lokalt…"
                      value={titleQuery}
                      onChange={(e) => setTitleQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Kategori</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Alle</SelectItem>
                      <SelectItem value={CAT_NONE}>Ikke kategorisert</SelectItem>
                      {categoryValues.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Alle</SelectItem>
                      <SelectItem value={STATUS_NONE}>Aktiv (standard)</SelectItem>
                      {statusValues.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Synlighet</Label>
                  <Select value={visibility} onValueChange={setVisibility}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Alle</SelectItem>
                      <SelectItem value={VIS_NONE}>Privat (standard)</SelectItem>
                      {visibilityValues.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  title={hasActiveFilters ? "Ingen dokumenter matcher" : "Ingen dokumenter"}
                  description={
                    hasActiveFilters
                      ? "Nullstill filtre eller søk for å se hele listen."
                      : "Ingen rader å vise."
                  }
                />
              ) : (
                <ul className="divide-y rounded-md border">
                  {filtered.map((d) => {
                    const company = d.applications?.company_name ?? "—";
                    const role = d.applications?.role_title;
                    const typeLabel = DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type;
                    return (
                      <li key={d.id}>
                        <Link
                          to="/documents/$id"
                          params={{ id: d.id }}
                          className={cn(
                            "group flex flex-col gap-2 py-3 px-3 text-sm transition-colors sm:flex-row sm:flex-wrap sm:items-center sm:gap-3",
                            "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium leading-snug group-hover:underline">
                                {d.title}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <Badge variant="secondary" className="font-normal">
                                  {labelCategory(d)}
                                </Badge>
                                <Badge variant="outline" className="font-normal">
                                  {labelStatus(d)}
                                </Badge>
                                <Badge variant="outline" className="font-normal">
                                  {labelVisibility(d)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:ml-auto sm:justify-end">
                            <span>{typeLabel}</span>
                            <span className="truncate max-w-[200px]">
                              {company}
                              {role ? ` · ${role}` : ""}
                            </span>
                            <span className="tabular-nums whitespace-nowrap">
                              {fmtDate(d.updated_at ?? d.created_at)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-foreground font-medium group-hover:bg-accent">
                              Åpne
                              <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </DocumentationLayout>
  );
}
