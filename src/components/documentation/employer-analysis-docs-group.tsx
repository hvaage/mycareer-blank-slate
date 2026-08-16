// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Building2, ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LINK_STATUS_NOTE, type EmployerAnalysisLink } from "@/lib/queries/employer-analysis-docs";

type DocRow = { id: string; title: string };

/**
 * Arbeidsgiveranalyser i dokumentlisten.
 * Trygt koblede analyser vises på selskapssiden under Marked; her står bare en
 * lenke til dem. Analyser med usikker kobling blir stående som egen gruppe.
 */
export function EmployerAnalysisDocsGroup({
  uncertain,
  linked,
  links,
}: {
  uncertain: DocRow[];
  linked: DocRow[];
  links: Record<string, EmployerAnalysisLink>;
}) {
  if (uncertain.length === 0 && linked.length === 0) return null;

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Arbeidsgiveranalyser</span>
        <span className="text-xs text-muted-foreground">
          {uncertain.length + linked.length} totalt
        </span>
      </div>

      {linked.length > 0 && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {linked.length} analyse{linked.length === 1 ? "" : "r"} er koblet til et selskap i
          registeret og vises på selskapets side under{" "}
          <Link to="/marked" className="underline underline-offset-2">
            Marked
          </Link>
          .
        </p>
      )}

      {uncertain.length === 0 ? null : (
        <ul className="divide-y">
          {uncertain.map((d) => {
            const link = links[d.id];
            return (
              <li key={d.id}>
                <Link
                  to="/documents/$id"
                  params={{ id: d.id }}
                  className="group flex flex-col gap-1 px-3 py-3 text-sm transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium leading-snug group-hover:underline">{d.title}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        {LINK_STATUS_NOTE[link?.status ?? "unmatched"]}
                        {link?.companyName ? ` («${link.companyName}»)` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="w-fit font-normal">
                    Usikker kobling
                  </Badge>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                    Åpne <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
