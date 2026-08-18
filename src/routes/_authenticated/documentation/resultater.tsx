// @ts-nocheck
/**
 * Resultater i Min dokumentasjon leser to kilder:
 *  1) bekreftede resultat-atomer fra Karriereoversikt (CV-import + manuelt),
 *  2) resultater registrert direkte under Min dokumentasjon.
 * Ingen dobbeltlagring — atomene vises som de er, gruppert under rollen sin.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { useAuth } from "@/lib/auth-context";
import { documentationAtomBasisQuery } from "@/lib/queries/documentation-atoms";
import { professionalResultsListQuery } from "@/lib/queries/documentation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/documentation/resultater")({
  component: DocumentationResultsPage,
});

const ATTESTATION_LABEL: Record<string, string> = {
  selvrapportert: "Selvrapportert",
  dokumentert: "Dokumentert",
  bekreftet_av_leder: "Bekreftet av leder",
  bekreftet_tredjepart: "Bekreftet av tredjepart",
};

function DocumentationResultsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const basis = useQuery(documentationAtomBasisQuery(userId));
  const manual = useQuery(professionalResultsListQuery());

  const data = basis.data;
  const grouped = (data?.roles ?? []).map((role) => ({
    role,
    label: data?.roleLabelById[role.id] ?? role.content_no ?? "Rolle",
    items: (data?.results ?? []).filter((r) => r.parent_atom_id === role.id),
  }));
  const loose = (data?.results ?? []).filter((r) => !r.parent_atom_id);

  return (
    <DocumentationLayout>
      <div className="space-y-6">
        <Card className="max-w-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resultatene dine</CardTitle>
            <CardDescription>
              Dette er resultatene fra karrieregrunnlaget ditt — inkludert det som er hentet fra CV
              og bekreftet i gjennomgangen — samt resultater du har registrert her.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/about-me" search={{ tab: "karriereoversikt" }}>
                Åpne Karriereoversikt
              </Link>
            </Button>
          </CardContent>
        </Card>

        {basis.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : basis.isError ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-destructive">
                Kunne ikke laste resultatene
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(basis.error as Error)?.message ?? "Ukjent feil"}
            </CardContent>
          </Card>
        ) : (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Fra karrieregrunnlaget ({(data?.results ?? []).length})
            </h2>

            {(data?.results ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingen bekreftede resultater ennå. Fullfør CV-gjennomgangen for å få dem hit.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {grouped
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <Card key={g.role.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{g.label}</CardTitle>
                        <CardDescription>{g.items.length} resultater</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {g.items.map((r) => (
                            <li key={r.id} className="text-sm leading-snug">
                              <span>{r.content_no ?? "(uten tekst)"}</span>{" "}
                              <Badge
                                variant="secondary"
                                className="h-5 px-1.5 text-[11px] font-normal"
                              >
                                {ATTESTATION_LABEL[String(r.attestation ?? "")] ?? "Selvrapportert"}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}

                {loose.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Uten kjent rolle</CardTitle>
                      <CardDescription>{loose.length} resultater</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {loose.map((r) => (
                          <li key={r.id} className="text-sm leading-snug">
                            {r.content_no ?? "(uten tekst)"}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Registrert i Min dokumentasjon ({(manual.data ?? []).length})
          </h2>
          {manual.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (manual.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen registrert her ennå.{" "}
              <Link to="/documentation/cases" className="underline underline-offset-2">
                Registrer et resultat
              </Link>
              .
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(manual.data ?? []).map((r: any) => (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{r.title}</CardTitle>
                    {r.metric_name || r.metric_value ? (
                      <CardDescription>
                        {[r.metric_name, r.metric_value].filter(Boolean).join(": ")}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  {r.description ? (
                    <CardContent className="text-sm text-muted-foreground">
                      {r.description}
                    </CardContent>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </DocumentationLayout>
  );
}
