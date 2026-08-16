// @ts-nocheck
/**
 * 5a — Erfaring og kompetanse: ren visning av grunnlaget (atom_kind = 'evidens').
 * Ingen handlinger. Rekkefølge: roller → resultater → kompetanse → kvalifikasjoner
 * → eksponering → verktøy. Utdatert vises aldri for evidens.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, FileText, Lightbulb, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { careerAtomsQuery, type CareerAtomRow } from "@/lib/queries/career-atoms";
import { ATOM_TYPE_LABEL, ATOM_TYPE_CLASS } from "@/lib/queries/cv-parse-candidates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const ATTESTATION_LABEL: Record<string, string> = {
  selvrapportert: "Selvrapportert",
  dokumentert: "Dokumentert",
  bekreftet_av_leder: "Bekreftet av leder",
  bekreftet_tredjepart: "Bekreftet av tredjepart",
};

const SOURCE_LABEL: Record<string, string> = {
  cv_import: "Importert fra CV",
  cv: "Importert fra CV",
  manual: "Lagt inn manuelt",
  manuell: "Lagt inn manuelt",
  user: "Lagt inn manuelt",
  proposal: "Foreslått og godkjent",
  enrichment: "Foreslått og godkjent",
  ai: "Foreslått og godkjent",
};

function sourceLabel(row: CareerAtomRow) {
  return SOURCE_LABEL[String(row.source_type ?? "")] ?? `Kilde: ${row.source_type ?? "ukjent"}`;
}

function classOf(row: CareerAtomRow): string | null {
  return (row.atom_class as string | null) ?? ATOM_TYPE_CLASS[row.atom_type as never] ?? null;
}

function AtomLine({ row, extra }: { row: CareerAtomRow; extra?: string }) {
  const cls = classOf(row);
  const links = (row.evidence_atom_ids ?? []) as string[];
  const missingEvidence =
    (cls === "kompetanse" || cls === "eksponering") && links.length === 0 && !row.parent_atom_id;

  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="min-w-0 flex-1 text-sm">{row.content_no ?? "(uten tekst)"}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {extra ? (
          <span className="text-xs text-muted-foreground">{extra}</span>
        ) : null}
        {missingEvidence ? (
          <Badge variant="outline" className="border-amber-500/50 font-normal text-amber-700 dark:text-amber-400">
            Mangler belegg
          </Badge>
        ) : null}
        <Badge variant="secondary" className="font-normal">
          {ATTESTATION_LABEL[String(row.attestation ?? "")] ?? "Selvrapportert"}
        </Badge>
        {!row.user_confirmed ? (
          <Badge variant="outline" className="font-normal">
            Ikke bekreftet
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">{sourceLabel(row)}</span>
      </div>
    </li>
  );
}

function Group({
  title,
  description,
  rows,
}: {
  title: string;
  description?: string;
  rows: CareerAtomRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">Ingen registrert.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <AtomLine key={r.id} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChain() {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="text-base">Grunnlaget ditt er tomt ennå</CardTitle>
        <CardDescription>
          Erfaring og kompetanse bygges som en kjede. Ingenting står alene — hvert ledd hviler på
          det forrige.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Rollen</strong> — hvor du var og hva du hadde ansvar for.
              <span className="block text-muted-foreground">
                Eksempel: Prosjektleder i Advania, 2021–2024.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Det du oppnådde</strong> — konkrete resultater i den rollen.
              <span className="block text-muted-foreground">
                Eksempel: Kuttet leveransetid fra 12 til 7 uker.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <strong>Kompetansen det belegger</strong> — utledes av resultatene, ikke påstått fritt.
              <span className="block text-muted-foreground">
                Eksempel: Prosessforbedring, belagt av resultatet over.
              </span>
            </span>
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button asChild>
            <Link to="/documentation/library">
              <Upload className="mr-2 h-4 w-4" /> Last opp CV under Dokumentasjon
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Legg inn en rolle manuelt (kommer)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExperienceOverview() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data, isLoading, isError, error } = useQuery({
    ...careerAtomsQuery(userId),
    enabled: !!userId,
  });

  const atoms = useMemo(
    () => ((data ?? []) as CareerAtomRow[]).filter((a) => a.atom_kind === "evidens" && a.is_active),
    [data],
  );

  const roles = atoms.filter((a) => a.atom_type === "role");
  const byClass = (c: string) => atoms.filter((a) => classOf(a) === c);
  const results = byClass("resultat");
  const skills = byClass("kompetanse");
  const exposure = byClass("eksponering");
  const qualifications = byClass("kvalifikasjon");
  const tools = byClass("instrument");

  const childrenOf = (roleId: string) => (rows: CareerAtomRow[]) =>
    rows.filter((r) => r.parent_atom_id === roleId);

  const skillsForRole = (role: CareerAtomRow, roleResults: CareerAtomRow[]) => {
    const ids = new Set<string>([role.id, ...roleResults.map((r) => r.id)]);
    return skills
      .map((s) => {
        const links = ((s.evidence_atom_ids ?? []) as string[]).filter((id) => ids.has(id));
        return { atom: s, count: links.length };
      })
      .filter((x) => x.count > 0);
  };

  const attachedSkillIds = new Set<string>();
  const roleBlocks = roles.map((role) => {
    const roleResults = childrenOf(role.id)(results);
    const roleExposure = childrenOf(role.id)(exposure);
    const roleSkills = skillsForRole(role, roleResults);
    roleSkills.forEach((s) => attachedSkillIds.add(s.atom.id));
    return { role, roleResults, roleExposure, roleSkills };
  });

  const looseSkills = skills.filter((s) => !attachedSkillIds.has(s.id));
  const looseResults = results.filter((r) => !r.parent_atom_id);
  const looseExposure = exposure.filter((e) => !e.parent_atom_id);

  if (!userId || isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Kunne ikke laste grunnlaget</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {(error as Error)?.message ?? "Ukjent feil"}
        </CardContent>
      </Card>
    );
  }

  if (atoms.length === 0) return <EmptyChain />;

  return (
    <div className="space-y-6">
      {roleBlocks.length > 0 ? (
        <div className="space-y-4">
          {roleBlocks.map(({ role, roleResults, roleExposure, roleSkills }) => (
            <Card key={role.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{role.content_no ?? "Rolle"}</CardTitle>
                  <Badge variant="secondary" className="font-normal">
                    {ATTESTATION_LABEL[String(role.attestation ?? "")] ?? "Selvrapportert"}
                  </Badge>
                  {!role.user_confirmed ? (
                    <Badge variant="outline" className="font-normal">
                      Ikke bekreftet
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{sourceLabel(role)}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Resultater ({roleResults.length})
                  </h3>
                  {roleResults.length === 0 ? (
                    <p className="py-1 text-sm text-muted-foreground">
                      Ingen resultater registrert på denne rollen.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {roleResults.map((r) => (
                        <AtomLine key={r.id} row={r} extra={ATOM_TYPE_LABEL[r.atom_type as never]} />
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Kompetanse som hviler på rollen ({roleSkills.length})
                  </h3>
                  {roleSkills.length === 0 ? (
                    <p className="py-1 text-sm text-muted-foreground">
                      Ingen kompetanse er belagt av denne rollen ennå.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {roleSkills.map(({ atom, count }) => (
                        <AtomLine
                          key={atom.id}
                          row={atom}
                          extra={`${count} belegg`}
                        />
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Eksponering fra rollen ({roleExposure.length})
                  </h3>
                  {roleExposure.length === 0 ? (
                    <p className="py-1 text-sm text-muted-foreground">Ingen eksponering avledet.</p>
                  ) : (
                    <ul className="divide-y">
                      {roleExposure.map((e) => (
                        <AtomLine key={e.id} row={e} />
                      ))}
                    </ul>
                  )}
                </section>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ingen roller registrert</CardTitle>
            <CardDescription>
              Resultater og kompetanse under hviler ikke på en rolle ennå.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {looseResults.length > 0 ? (
        <Group
          title="Resultater uten rolle"
          description="Disse er ikke koblet til en rolle."
          rows={looseResults}
        />
      ) : null}
      {looseSkills.length > 0 ? (
        <Group
          title="Kompetanse uten belegg i en rolle"
          description="Kompetanse skal hvile på et resultat eller en rolle."
          rows={looseSkills}
        />
      ) : null}

      <Group title="Kvalifikasjoner" rows={qualifications} />
      {looseExposure.length > 0 ? (
        <Group title="Eksponering uten rolle" rows={looseExposure} />
      ) : null}
      <Group title="Verktøy" rows={tools} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        Visning uten handlinger. Redigering, sletting og bekreftelse kommer i neste leveranse.
      </p>
    </div>
  );
}
