import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { allDocumentsQuery } from "@/lib/queries/sub-resources";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { fmtDate } from "@/lib/format";
import { Plus, Building2, FileText, Calendar, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/documents/")({
  component: DocumentsPage,
});

type DocRow = any;

function DocumentsPage() {
  const { data, isLoading } = useQuery(allDocumentsQuery());

  const grouped = useMemo(() => {
    const docs = (data ?? []) as DocRow[];
    const map = new Map<string, { company: string; docs: DocRow[]; latest: number }>();
    for (const d of docs) {
      const company = d.applications?.company_name ?? d.company_name ?? "Uten selskap";
      const key = company.toLowerCase();
      const ts = new Date(d.updated_at ?? d.created_at).getTime();
      const entry = map.get(key);
      if (entry) {
        entry.docs.push(d);
        entry.latest = Math.max(entry.latest, ts);
      } else {
        map.set(key, { company, docs: [d], latest: ts });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latest - a.latest);
  }, [data]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dokumenter</h1>
        <Button asChild>
          <Link to="/documents/new"><Plus className="h-4 w-4 mr-2" /> Nytt dokument</Link>
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data?.length ? (
        <EmptyState title="Ingen dokumenter ennå" />
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <Card key={g.company}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {g.company}
                  <span className="text-xs font-normal text-muted-foreground ml-auto">
                    {g.docs.length} dokument{g.docs.length === 1 ? "" : "er"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y">
                  {g.docs.map((d) => {
                    const role = d.applications?.role_title ?? d.tailored_for ?? null;
                    const status = d.applications?.status as string | undefined;
                    const appliedDate = d.applications?.applied_date as string | null | undefined;
                    const isSubmitted = !!appliedDate && status && status !== "identifisert" && status !== "søknad_generert";
                    return (
                      <li key={d.id}>
                        <Link
                          to="/documents/$id"
                          params={{ id: d.id }}
                          className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-accent/30 text-sm"
                        >
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate flex-1 min-w-0">{d.title}</span>
                          {role && (
                            <span className="text-xs text-muted-foreground truncate hidden md:inline max-w-[200px]">
                              {role}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
                            {DOCUMENT_TYPE_LABELS[d.document_type]} v{d.version}
                          </span>
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                            <Calendar className="h-3 w-3" />
                            {fmtDate(d.created_at)}
                          </span>
                          {isSubmitted ? (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 whitespace-nowrap">
                              <Send className="h-3 w-3" />
                              {fmtDate(appliedDate!)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/60 whitespace-nowrap">—</span>
                          )}
                          {d.file_name && <span className="text-xs">📎</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
