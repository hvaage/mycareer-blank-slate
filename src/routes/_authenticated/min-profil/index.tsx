// @ts-nocheck
// ============================================================
// Min profil — én samlet, lesbar oversikt over karriereretning,
// erfaring, kompetanse og dokumentasjon.
//
// Siden skriver ingenting. Redigering skjer der opplysningen eier
// seg: Om meg (preferanser), CV-gjennomgang (importerte forslag),
// Min dokumentasjon (dokumenter).
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageSectionNav } from "@/components/layout/page-section-nav";
import { getCareerStage } from "@/lib/career-stage";
import { docRoleLabel } from "@/lib/queries/documentation-atoms";
import {
  AREA_STATUS_LABEL,
  filledOf,
  statusFromCount,
  useProfileOverviewData,
  type AreaStatus,
} from "@/lib/queries/profile-overview";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, CircleDot, Circle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/min-profil/")({
  head: () => ({
    meta: [
      { title: "Min profil — Karrierenmin" },
      {
        name: "description",
        content:
          "Samlet oversikt over karriereretning, erfaring, kompetanse og dokumentasjon som brukes i jobbmatching og CV.",
      },
      { property: "og:title", content: "Min profil — Karrierenmin" },
      {
        property: "og:description",
        content: "Se hva som er utfylt, hva som mangler og hva som venter på gjennomgang.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MinProfilPage,
});

type Area = {
  id: string;
  label: string;
  status: AreaStatus;
  counter?: string;
  why: string;
  /** Når satt, navigerer boksen til en egen side i stedet for å hoppe til en seksjon. */
  to?: string;
  search?: Record<string, string>;
};

function StatusIcon({ status }: { status: AreaStatus }) {
  if (status === "fullfort") return <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "gjennomgang") return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />;
  if (status === "delvis") return <CircleDot className="h-3.5 w-3.5 text-amber-600" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />;
}

const AREA_BOX_CLASS = cn(
  "flex h-full flex-col gap-1 rounded-lg border border-border bg-card p-3",
  "transition-colors hover:border-muted-foreground/30 hover:bg-muted/40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

function AreaBoxBody({ area }: { area: Area }) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
        <StatusIcon status={area.status} />
        <span className="truncate">{area.label}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {AREA_STATUS_LABEL[area.status]}
        {area.counter ? ` · ${area.counter}` : ""}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground/80">{area.why}</span>
    </>
  );
}

function AreaStrip({ areas }: { areas: Area[] }) {
  return (
    <nav aria-label="Statusoversikt">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) => (
          <li key={`${a.id}-${a.label}`}>
            {a.to ? (
              <Link to={a.to} search={a.search as never} className={AREA_BOX_CLASS}>
                <AreaBoxBody area={a} />
              </Link>
            ) : (
              <a
                href={`#${a.id}`}
                onClick={(e) => {
                  const el = document.getElementById(a.id);
                  if (!el) return;
                  e.preventDefault();
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={AREA_BOX_CLASS}
              >
                <AreaBoxBody area={a} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}


function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">
        {value?.trim() ? value : <span className="text-muted-foreground">Ikke utfylt</span>}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MinProfilPage() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const { isLoading, atoms, profile, careerStage, pending } = useProfileOverviewData(uid);

  const list = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : null);
  const salary = useMemo(() => {
    if (!profile) return null;
    const min = profile.salary_expectation_min;
    const max = profile.salary_expectation_max;
    if (min == null && max == null) return null;
    const f = (n: number | null) => (n == null ? "?" : new Intl.NumberFormat("nb-NO").format(n));
    return `${f(min)}–${f(max)} ${profile.salary_currency ?? "NOK"}`;
  }, [profile]);

  const stageDef = careerStage ? getCareerStage(careerStage) : null;

  const roles = atoms?.roles ?? [];
  const results = atoms?.results ?? [];
  const skills = atoms?.skills ?? [];
  const qualifications = atoms?.qualifications ?? [];
  const needsReview = pending.pendingCandidates > 0 || pending.openImports > 0;

  const areas: Area[] = useMemo(() => {
    const direction = filledOf(careerStage, profile?.target_seniority, profile?.target_roles, profile?.target_industries);
    const wishes = filledOf(
      profile?.work_types,
      profile?.preferred_locations,
      profile?.job_search_keywords,
      profile?.salary_expectation_min ?? profile?.salary_expectation_max,
    );
    const countStatus = (n: number): AreaStatus => (n > 0 ? "fullfort" : "mangler");
    return [
      {
        id: "om-meg",
        label: "Om meg",
        status: statusFromCount(direction + wishes, 8),
        counter: `${direction + wishes} av 8 svar`,
        why: "Svarene dine om bakgrunn, situasjon og ønsker.",
        to: "/about-me",
        search: { tab: "kort_om_meg" },
      },
      {
        id: "karriereretning",
        label: "Karriereretning",
        status: statusFromCount(direction, 4),
        counter: `${direction} av 4`,
        why: "Styrer hvilke stillinger som vurderes for deg.",
      },

      {
        id: "karriereoversikt",
        label: "Erfaring og roller",
        status: needsReview ? "gjennomgang" : countStatus(roles.length),
        counter: `${roles.length} bekreftede roller`,
        why: "Grunnlaget for CV og vurdering av relevans.",
      },
      {
        id: "karriereoversikt",
        label: "Resultater og kompetanse",
        status: needsReview ? "gjennomgang" : countStatus(results.length + skills.length),
        counter: `${results.length} resultater · ${skills.length} kompetanser`,
        why: "Det du kan belegge med konkrete eksempler.",
      },
      {
        id: "karriereoversikt",
        label: "Utdanning og kvalifikasjoner",
        status: countStatus(qualifications.length),
        counter: `${qualifications.length} registrert`,
        why: "Formelle krav i utlysninger sjekkes mot dette.",
      },
      {
        id: "karriereretning",
        label: "Jobbønsker",
        status: statusFromCount(wishes, 4),
        counter: `${wishes} av 4`,
        why: "Arbeidsform, sted, søkeord og lønnsforventning.",
      },
      {
        id: "dokumentasjon",
        label: "Dokumentasjon",
        status: pending.documents > 0 ? "fullfort" : "mangler",
        counter: `${pending.documents} dokumenter`,
        why: "Belegg du kan vedlegge søknader og intervjuer.",
      },
    ];
  }, [careerStage, profile, roles.length, results.length, skills.length, qualifications.length, needsReview, pending.documents]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Min profil</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Her samles karriereretning, erfaring, kompetanse og dokumentasjon — grunnlaget som brukes
          når stillinger vurderes og når CV og søknad settes opp.
        </p>
      </header>

      {isLoading ? <Skeleton className="h-24 w-full" /> : <AreaStrip areas={areas} />}

      {needsReview && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {pending.pendingCandidates > 0
                ? `${pending.pendingCandidates} element${pending.pendingCandidates === 1 ? "" : "er"} venter på gjennomgang`
                : "Du har en CV-import som ikke er ferdig bekreftet"}
            </CardTitle>
            <CardDescription>
              Forslag fra CV teller ikke som bekreftet profil før du har godkjent dem.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {pending.pendingCandidates > 0 && (
              <Button asChild size="sm">
                <Link to="/career/cv-review">Fortsett gjennomgangen</Link>
              </Button>
            )}
            {pending.openImports > 0 && (
              <Button asChild size="sm" variant="outline">
                <Link to="/about-me" search={{ tab: "karriereoversikt" }}>
                  Fullfør CV-importen
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Section
        id="karriereretning"
        title="Karriereretning"
        description="Hvor du står i dag og hva du søker mot. Svarene redigeres under Om meg."
      >
        <Card>
          <CardContent className="pt-6">
            <SummaryRow label="Karrierestadium" value={stageDef?.labelNb ?? null} />
            <SummaryRow label="Nivå du søker" value={profile?.target_seniority ?? null} />
            <SummaryRow label="Ønskede roller" value={list(profile?.target_roles)} />
            <SummaryRow label="Ønskede bransjer" value={list(profile?.target_industries)} />
            <SummaryRow label="Arbeidsform" value={list(profile?.work_types)} />
            <SummaryRow label="Steder" value={list(profile?.preferred_locations)} />
            <SummaryRow label="Søkeord" value={list(profile?.job_search_keywords)} />
            <SummaryRow label="Lønnsforventning" value={salary} />
            <div className="flex flex-wrap gap-2 pt-4">
              <Button asChild size="sm" variant="outline">
                <Link to="/about-me" search={{ tab: "kort_om_meg" }}>
                  Endre jobbønsker
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/min-profil/karriereretning">Endre karrierestadium</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="karriereoversikt"
        title="Karriereoversikt"
        description="Bekreftet innhold fra karriereoversikten. Forslag som ikke er godkjent vises ikke her."
      >
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            { label: "Roller", value: roles.length },
            { label: "Resultater", value: results.length },
            { label: "Kompetanser", value: skills.length },
            { label: "Kvalifikasjoner", value: qualifications.length },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border bg-card p-3">
              <p className="text-xl font-semibold tabular-nums">{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>

        {roles.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Roller og arbeidsgivere</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {roles.slice(0, 5).map((r) => (
                <p key={r.id} className="truncate text-sm">
                  {docRoleLabel(r)}
                </p>
              ))}
              {roles.length > 5 && (
                <p className="text-xs text-muted-foreground">+ {roles.length - 5} flere</p>
              )}
            </CardContent>
          </Card>
        )}

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.slice(0, 12).map((s) => (
              <Badge key={s.id} variant="secondary" className="font-normal">
                {s.content_no}
              </Badge>
            ))}
            {skills.length > 12 && (
              <span className="self-center text-xs text-muted-foreground">
                + {skills.length - 12} flere
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/karriere/erfaring">Åpne erfaring og kompetanse</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/documentation/resultater">Resultater</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/documentation/kompetanse">Kompetanser</Link>
          </Button>
        </div>
      </Section>

      <Section
        id="dokumentasjon"
        title="CV og dokumentasjon"
        description="Status for CV-import og dokumentene du kan bruke som belegg."
      >
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p>
              CV-gjennomgang:{" "}
              <strong>
                {needsReview
                  ? pending.pendingCandidates > 0
                    ? `${pending.pendingCandidates} element${pending.pendingCandidates === 1 ? "" : "er"} venter`
                    : "import ikke ferdig bekreftet"
                  : "ingenting venter"}
              </strong>
            </p>
            <p>
              Dokumenter: <strong>{pending.documents}</strong>
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/min-profil/importgjennomgang">Importgjennomgang</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/about-me" search={{ tab: "cv" }}>
                  CV-filer
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/career/cv-review">CV-gjennomgang</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/documentation">Min dokumentasjon</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
