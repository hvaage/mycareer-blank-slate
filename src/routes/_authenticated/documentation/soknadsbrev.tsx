// @ts-nocheck
// ============================================================
// Min dokumentasjon → Søknadsbrev
// Leseoversikt over lagrede søknadsbrev. Nye brev lages under
// Søknader → Lag søknadsdokumenter.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { downloadDocument } from "@/lib/queries/cv-archive";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Download, FileText, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/documentation/soknadsbrev")({
  head: () => ({
    meta: [
      { title: "Søknadsbrev — Min dokumentasjon — Karrierenmin" },
      {
        name: "description",
        content: "Alle lagrede søknadsbrev samlet på ett sted, med selskap, stilling og dato.",
      },
      { property: "og:title", content: "Søknadsbrev — Min dokumentasjon" },
      {
        property: "og:description",
        content: "Se og åpne søknadsbrevene dine, eller lag et nytt under Søknader.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentationCoverLettersPage,
});

function DocumentationCoverLettersPage() {
  const { user } = useAuth();
  const uid = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["documentation", "cover-letters", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id, title, file_path, file_name, created_at, company_name, application_id, applications(company_name, role_title)",
        )
        .eq("user_id", uid)
        .eq("document_type", "søknadsbrev")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = data ?? [];

  return (
    <DocumentationLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold tracking-tight">Søknadsbrev</CardTitle>
            <CardDescription className="max-w-3xl">
              Her ligger søknadsbrevene dine samlet. Nye brev lages under Søknader, sammen med
              generell og stillingstilpasset CV.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link to="/soknadsdokumenter">Lag søknadsdokumenter</Link>
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Ingen søknadsbrev ennå"
            description="Når du lager et søknadsbrev, dukker det opp her."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              {rows.map((d: any) => (
                <div
                  key={d.id}
                  className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {d.title ?? d.file_name ?? "Søknadsbrev"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          d.applications?.company_name ?? d.company_name,
                          d.applications?.role_title,
                          d.created_at ? fmtDate(d.created_at) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  {d.file_path ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        downloadDocument(d.file_path).catch((e) =>
                          toast.error(e instanceof Error ? e.message : "Kunne ikke åpne filen"),
                        )
                      }
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Åpne
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DocumentationLayout>
  );
}
