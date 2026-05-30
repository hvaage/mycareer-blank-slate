// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { recentChangeLogQuery } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/changelog")({
  component: AdminPage,
});

function AdminPage() {
  const log = useQuery(recentChangeLogQuery());

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Administrasjon</h1>
          <p className="text-sm text-muted-foreground">Aktivitet og logg</p>
        </div>
        <Link to="/admin/cv-test" className="text-sm underline text-primary">
          CV-pipeline test →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Siste endringer</CardTitle>
        </CardHeader>
        <CardContent>
          {log.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !log.data?.length ? (
            <EmptyState title="Ingen aktivitet ennå" />
          ) : (
            <ul className="divide-y text-sm">
              {log.data.map((e: any) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link
                      to="/applications/$id"
                      params={{ id: e.application_id }}
                      className="hover:underline"
                    >
                      <div className="truncate">{e.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.applications?.company_name}
                      </div>
                    </Link>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(e.changed_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
