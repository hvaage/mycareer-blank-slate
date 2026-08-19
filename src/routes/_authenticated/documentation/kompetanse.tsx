// @ts-nocheck
/**
 * Kompetanser i Min dokumentasjon. Kompetanse og eksponering belegges aldri
 * direkte — de vises med hvilke roller/resultater som beleger dem.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { useAuth } from "@/lib/auth-context";
import { documentationAtomBasisQuery } from "@/lib/queries/documentation-atoms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/documentation/kompetanse")({
  component: DocumentationSkillsPage,
});

function DocumentationSkillsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data, isLoading, isError, error } = useQuery(documentationAtomBasisQuery(userId));

  const labelFor = (id: string) => {
    if (!data) return null;
    if (data.roleLabelById[id]) return data.roleLabelById[id];
    const result = data.results.find((r) => r.id === id);
    if (!result) return null;
    const roleLabel = result.parent_atom_id ? data.roleLabelById[result.parent_atom_id] : null;
    return roleLabel ? `Resultat under ${roleLabel}` : "Resultat";
  };

  const withBacking = (rows: any[]) =>
    rows.map((row) => {
      const ids = [
        ...((row.evidence_atom_ids ?? []) as string[]),
        ...(row.parent_atom_id ? [row.parent_atom_id] : []),
      ];
      const backing = Array.from(new Set(ids.map(labelFor).filter(Boolean))) as string[];
      return { row, backing };
    });

  const skills = withBacking(data?.skills ?? []);
  const exposure = withBacking(data?.exposure ?? []);
  const qualifications = data?.qualifications ?? [];

  return (
    <DocumentationLayout>
      <div className="space-y-6">
        <Card className="max-w-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Kompetansene dine</CardTitle>
            <CardDescription>
              Kompetanse påstås ikke fritt — den utledes av roller og resultater. Under hver
              kompetanse ser du hva den hviler på.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/kilder">
                Legg til kilder
              </Link>
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : isError ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-destructive">
                Kunne ikke laste kompetansene
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? "Ukjent feil"}
            </CardContent>
          </Card>
        ) : (
          <>
            <SkillSection title="Kompetanse" items={skills} />
            <SkillSection title="Eksponering" items={exposure} />

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                Kvalifikasjoner ({qualifications.length})
              </h2>
              {qualifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen registrert ennå.</p>
              ) : (
                <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {qualifications.map((q) => (
                    <li key={q.id} className="text-sm leading-snug">
                      {q.content_no ?? "(uten tekst)"}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </DocumentationLayout>
  );
}

function SkillSection({ title, items }: { title: string; items: any[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ingen registrert ennå. Fullfør CV-gjennomgangen for å få dem hit.
        </p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {items.map(({ row, backing }) => (
            <Card key={row.id}>
              <CardContent className="space-y-1.5 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{row.content_no ?? "(uten tekst)"}</span>
                  {backing.length === 0 ? (
                    <Badge
                      variant="outline"
                      className="h-5 border-amber-500/50 px-1.5 text-[11px] font-normal text-amber-700 dark:text-amber-400"
                    >
                      Mangler belegg
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
                      {backing.length} belegg
                    </Badge>
                  )}
                </div>
                {backing.length > 0 ? (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {backing.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
