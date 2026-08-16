// @ts-nocheck
/**
 * 5a — Erfaring og kompetanse: ren visning av grunnlaget (atom_kind = 'evidens').
 * Ingen handlinger. Rekkefølge: roller → resultater → kompetanse → kvalifikasjoner
 * → eksponering → verktøy. Utdatert vises aldri for evidens.
 *
 * Layout: klebrig seksjonsmeny med antall, to kolonner for rollekort (aldri tre),
 * to–tre kolonner for korte lister, kollapsbare rollekort med husket tilstand.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  ChevronDown,
  FileText,
  Lightbulb,
  Upload,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { careerAtomsQuery, type CareerAtomRow } from "@/lib/queries/career-atoms";
import { AtomActions } from "@/components/career/atom-actions";

import { ATOM_TYPE_LABEL, ATOM_TYPE_CLASS } from "@/lib/queries/cv-parse-candidates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageSectionNav, type PageSection } from "@/components/layout/page-section-nav";
import { usePersistedCollapse } from "@/hooks/use-persisted-collapse";
import { cn } from "@/lib/utils";

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

function sd(row: CareerAtomRow): Record<string, any> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function roleEmployer(row: CareerAtomRow): string | null {
  const d = sd(row);
  return d.employer ?? d.organization ?? d.company ?? null;
}

function rolePeriod(row: CareerAtomRow): string | null {
  const d = sd(row);
  const from = d.start_date ?? d.from ?? null;
  const to = d.end_date ?? d.to ?? null;
  if (!from && !to) return null;
  const y = (v: string | null) => (v ? String(v).slice(0, 4) : null);
  return `${y(from) ?? "?"}–${y(to) ?? "nå"}`;
}

/** Tett linje: innhold og merkelapper på samme rad. */
function AtomLine({ row, extra }: { row: CareerAtomRow; extra?: string }) {
  const cls = classOf(row);
  const links = (row.evidence_atom_ids ?? []) as string[];
  const missingEvidence =
    (cls === "kompetanse" || cls === "eksponering") && links.length === 0 && !row.parent_atom_id;

  return (
    <li className="group flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
      <span className="min-w-0 flex-1 basis-48 text-sm leading-snug">
        {row.content_no ?? "(uten tekst)"}
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {extra ? <span className="text-[11px] text-muted-foreground">{extra}</span> : null}
        {missingEvidence ? (
          <Badge
            variant="outline"
            className="h-5 border-amber-500/50 px-1.5 text-[11px] font-normal text-amber-700 dark:text-amber-400"
          >
            Mangler belegg
          </Badge>
        ) : null}
        <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
          {ATTESTATION_LABEL[String(row.attestation ?? "")] ?? "Selvrapportert"}
        </Badge>
        {!row.user_confirmed ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
            Ikke bekreftet
          </Badge>
        ) : null}
        <span className="text-[11px] text-muted-foreground">{sourceLabel(row)}</span>
        <AtomActions row={row} />
      </span>
    </li>
  );
}


/** Seksjon med korte elementer uten hierarki — tåler to–tre kolonner. */
function Group({
  id,
  title,
  description,
  rows,
  columns = true,
  maxColumns = 3,
}: {
  id: string;
  title: string;
  description?: string;
  rows: CareerAtomRow[];
  columns?: boolean;
  maxColumns?: 2 | 3;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Ingen registrert.</p>
      ) : (
        <ul
          className={cn(
            "divide-y divide-border/60",
            columns && "lg:columns-2 lg:gap-x-8 [&>li]:break-inside-avoid",
            columns && maxColumns === 3 && "2xl:columns-3",
          )}
        >

          {rows.map((r) => (
            <AtomLine key={r.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RoleSubsection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-0.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children ?? <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
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
            <Link to="/about-me" search={{ tab: "karriereoversikt" }}>
              <Upload className="mr-2 h-4 w-4" /> Last opp CV under Om meg → Karriereoversikt
            </Link>
          </Button>

          <span className="text-sm text-muted-foreground">Legg inn en rolle manuelt (kommer)</span>
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

  // Standard: åpne kort ved færre enn fem roller, kollapset over det.
  const { isOpen, toggle, setAll } = usePersistedCollapse(
    "karriere.erfaring.roller",
    roles.length < 5,
  );

  const sections: PageSection[] = [
    { id: "sek-roller", label: "Roller", count: roleBlocks.length },
    { id: "sek-kvalifikasjoner", label: "Kvalifikasjoner", count: qualifications.length },
    { id: "sek-verktoy", label: "Verktøy", count: tools.length },
    { id: "sek-resultater-uten-rolle", label: "Resultater uten rolle", count: looseResults.length },
    { id: "sek-kompetanse-uten-belegg", label: "Kompetanse uten belegg", count: looseSkills.length },
    { id: "sek-eksponering-uten-rolle", label: "Eksponering uten rolle", count: looseExposure.length },
  ];

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

  const roleIds = roleBlocks.map((b) => b.role.id);
  const allOpen = roleIds.every((id) => isOpen(id));

  return (
    <div className="space-y-6">
      <PageSectionNav sections={sections} />

      {roleBlocks.length > 0 ? (
        <section id="sek-roller" className="scroll-mt-20">
          <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Roller</h2>
            <span className="text-xs text-muted-foreground">({roleBlocks.length})</span>
            <button
              type="button"
              onClick={() => setAll(roleIds, !allOpen)}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {allOpen ? "Lukk alle" : "Åpne alle"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {roleBlocks.map(({ role, roleResults, roleExposure, roleSkills }) => {
              const open = isOpen(role.id);
              const employer = roleEmployer(role);
              const period = rolePeriod(role);
              return (
                <Card key={role.id} className="overflow-hidden">
                  <div className="flex items-start gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => toggle(role.id)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-start gap-2 px-4 py-2.5 text-left hover:bg-accent/40"
                    >
                      <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {[role.content_no ?? "Rolle", employer, period].filter(Boolean).join(" · ")}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {roleResults.length} resultater · {roleSkills.length} kompetanser ·{" "}
                          {roleExposure.length} eksponering
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    <span className="pt-2.5">
                      <AtomActions row={role} />
                    </span>
                  </div>


                  {open ? (
                    <CardContent className="space-y-3 border-t px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
                          {ATTESTATION_LABEL[String(role.attestation ?? "")] ?? "Selvrapportert"}
                        </Badge>
                        {!role.user_confirmed ? (
                          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
                            Ikke bekreftet
                          </Badge>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          {sourceLabel(role)}
                        </span>
                      </div>

                      <RoleSubsection
                        title={`Resultater (${roleResults.length})`}
                        empty="Ingen resultater registrert på denne rollen."
                      >
                        {roleResults.length > 0 ? (
                          <ul className="divide-y divide-border/60">
                            {roleResults.map((r) => (
                              <AtomLine
                                key={r.id}
                                row={r}
                                extra={ATOM_TYPE_LABEL[r.atom_type as never]}
                              />
                            ))}
                          </ul>
                        ) : null}
                      </RoleSubsection>

                      <RoleSubsection
                        title={`Kompetanse som hviler på rollen (${roleSkills.length})`}
                        empty="Ingen kompetanse er belagt av denne rollen ennå."
                      >
                        {roleSkills.length > 0 ? (
                          <ul className="divide-y divide-border/60">
                            {roleSkills.map(({ atom, count }) => (
                              <AtomLine key={atom.id} row={atom} extra={`${count} belegg`} />
                            ))}
                          </ul>
                        ) : null}
                      </RoleSubsection>

                      <RoleSubsection
                        title={`Eksponering fra rollen (${roleExposure.length})`}
                        empty="Ingen eksponering avledet."
                      >
                        {roleExposure.length > 0 ? (
                          <ul className="divide-y divide-border/60">
                            {roleExposure.map((e) => (
                              <AtomLine key={e.id} row={e} />
                            ))}
                          </ul>
                        ) : null}
                      </RoleSubsection>
                    </CardContent>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
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

      <Group id="sek-kvalifikasjoner" title="Kvalifikasjoner" rows={qualifications} />
      <Group id="sek-verktoy" title="Verktøy" rows={tools} />

      {looseResults.length > 0 ? (
        <Group
          id="sek-resultater-uten-rolle"
          title="Resultater uten rolle"
          description="Disse er ikke koblet til en rolle."
          rows={looseResults}
          columns={false}
        />
      ) : null}
      {looseSkills.length > 0 ? (
        <Group
          id="sek-kompetanse-uten-belegg"
          title="Kompetanse uten belegg i en rolle"
          description="Kompetanse skal hvile på et resultat eller en rolle."
          rows={looseSkills}
          maxColumns={2}

        />
      ) : null}
      {looseExposure.length > 0 ? (
        <Group id="sek-eksponering-uten-rolle" title="Eksponering uten rolle" rows={looseExposure} />
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />

        Bruk menyen til høyre på hver linje for å bekrefte, endre eller slette. Sletting viser først
        hva annet som henger sammen med den.
      </p>

    </div>
  );
}
