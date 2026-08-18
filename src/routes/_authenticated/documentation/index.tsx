// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { documentationOverviewCountsQuery } from "@/lib/queries/documentation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BarChart3, Briefcase, FileText, Lightbulb, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/documentation/")({
  component: DocumentationOverviewPage,
});

function DocumentationOverviewPage() {
  const { data, isLoading, isError, error } = useQuery(documentationOverviewCountsQuery());

  return (
    <DocumentationLayout>
      <div className="space-y-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold tracking-tight">Hva er Min dokumentasjon?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
              Min dokumentasjon samler det profesjonelle materialet ditt—arbeidsprøver, case,
              resultater og pakker du kan gjenbruke i søknader og intervjuer. Det er et strukturert
              evidenslag, ikke et rått filarkiv: dokumenter knyttes til søknader og (senere) til
              tydelige profesjonelle historier du eier.
            </p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-destructive">Kunne ikke laste tall</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(error as Error)?.message ?? "Ukjent feil"}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              to="/documentation/library"
              icon={FileText}
              label="Dokumenter (bibliotek)"
              value={data?.documents ?? 0}
            />
            <StatCard
              to="/documentation/cases"
              icon={Briefcase}
              label="Profesjonelle case"
              value={data?.professionalCases ?? 0}
            />
            <StatCard
              to="/documentation/resultater"
              icon={BarChart3}
              label="Resultater"
              value={(data?.professionalResults ?? 0) + (data?.careerResults ?? 0)}
            />
            <StatCard
              to="/documentation/kompetanse"
              icon={Lightbulb}
              label="Kompetanser"
              value={data?.careerSkills ?? 0}
            />
            <StatCard
              to="/documentation/packages"
              icon={Package}
              label="Dokumentpakker"
              value={data?.documentationPackages ?? 0}
            />
          </div>
        )}


        <Card className="max-w-3xl">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <CardTitle className="text-base">Neste steg (anbefalinger)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5 marker:text-muted-foreground/60">
              <li>Legg inn eller koble dokumenter som støtter påstandene i CV og søknad.</li>
              <li>Bygg minst ett case med situasjon, ansvar, tiltak og målbar effekt.</li>
              <li>Registrer 2–3 konkrete resultater (KPI eller leveranse) du kan dokumentere.</li>
              <li>Forbered en dokumentpakke tilpasset rollen du søker mot.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DocumentationLayout>
  );
}

const STAT_LINK_ROUTES = [
  "/documentation/library",
  "/documentation/cases",
  "/documentation/packages",
] as const;
type StatCardTo = (typeof STAT_LINK_ROUTES)[number];

function StatCard({
  to,
  icon: Icon,
  label,
  value,
}: {
  to: StatCardTo;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${value}. Åpne side.`}
      className={cn(
        "group block rounded-xl outline-none",
        "transition-[color,box-shadow]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <Card
        className={cn(
          "h-full transition-[background-color,border-color,box-shadow]",
          "group-hover:bg-muted/35 group-hover:border-muted-foreground/25 group-hover:shadow-sm",
          "group-active:bg-muted/50",
        )}
      >
        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <CardTitle
            className={cn(
              "text-xs font-medium text-muted-foreground leading-snug pr-2 transition-colors",
              "group-hover:text-foreground",
            )}
          >
            {label}
          </CardTitle>
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 mt-0.5 text-muted-foreground transition-colors",
              "group-hover:text-foreground",
            )}
          />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
