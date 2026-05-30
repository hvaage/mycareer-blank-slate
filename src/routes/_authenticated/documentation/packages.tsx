// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { documentationPackagesListQuery } from "@/lib/queries/documentation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/documentation/packages")({
  component: DocumentationPackagesPage,
});

type PackageRow = {
  id: string;
  title: string;
  package_type: string;
  status: string;
  visibility?: string | null;
  target_role?: string | null;
  target_company?: string | null;
  updated_at?: string | null;
};

const PACKAGE_TYPE_LABELS: Record<string, string> = {
  job_application: "Søknad",
  executive_profile: "Lederprofil",
  board_profile: "Styreprofil",
  portfolio: "Portefølje",
  recruiter_share: "Rekrutteringsdeling",
};

function DocumentationPackagesPage() {
  const { data, isLoading, isError, error } = useQuery(documentationPackagesListQuery());

  return (
    <DocumentationLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dokumentpakker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pakkeoversikt (kun lesing). Redigering av innholdselementer kommer senere.
          </p>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : isError ? (
            <p className="text-sm text-destructive">{(error as Error)?.message ?? "Kunne ikke laste pakker."}</p>
          ) : !data?.length ? (
            <EmptyState title="Ingen dokumentpakker" description="Opprett pakker i en senere versjon." />
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {(data as PackageRow[]).map((p) => (
                <li key={p.id} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {PACKAGE_TYPE_LABELS[p.package_type] ?? p.package_type}
                      {p.target_company ? ` · ${p.target_company}` : ""}
                      {p.target_role ? ` · ${p.target_role}` : ""}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 sm:text-right tabular-nums">
                    {p.status}
                    {p.visibility ? ` · ${p.visibility}` : ""}
                    <br className="hidden sm:block" />
                    <span className="sm:ml-2">{fmtDate(p.updated_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </DocumentationLayout>
  );
}
