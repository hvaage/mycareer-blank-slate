// @ts-nocheck
// ============================================================
// Gjennomgå forslag — felles innboks for ventende arbeid fra alle kilder.
// Listen er kildeuavhengig: nye kildetyper legges til i SOURCE_QUEUES.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useReviewInboxCounts } from "@/lib/queries/review-inbox";
import { FileText, Sparkles, Linkedin, Building2, GraduationCap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/forslag/")({
  head: () => ({
    meta: [
      { title: "Gjennomgå forslag | Karrieren min" },
      {
        name: "description",
        content:
          "Samlet innboks for alt som venter på gjennomgang fra CV, arbeidsgiverdokumenter, LinkedIn og analysen.",
      },
      { property: "og:title", content: "Gjennomgå forslag | Karrieren min" },
      {
        property: "og:description",
        content: "Se hva som venter på deg, kilde for kilde, og fortsett der du slapp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForslagInboxPage,
});

function QueueCard({
  icon: Icon,
  title,
  description,
  count,
  statusText,
  action,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  count: number;
  statusText: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="max-w-prose">{description}</CardDescription>
            </div>
          </div>
          <Badge variant={count > 0 ? "default" : "secondary"} className="shrink-0 font-normal">
            {statusText}
          </Badge>
        </div>
      </CardHeader>
      {action ? <CardContent className="pt-0">{action}</CardContent> : null}
    </Card>
  );
}

function ForslagInboxPage() {
  const { user } = useAuth();
  const { data } = useReviewInboxCounts(user?.id);

  if (!user) return null;

  const cvCount = data?.cv ?? 0;
  const aiCount = data?.ai ?? 0;
  const linkedinCount = data?.linkedin ?? 0;
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Gjennomgå forslag</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Her ligger alt som venter på deg fra kildene dine. Ingenting blir en del av
          karriereoversikten før du har bekreftet det.
        </p>
      </header>

      <p className="text-sm text-muted-foreground">
        {total > 0 ? `${total} elementer venter på gjennomgang.` : "Ingenting venter akkurat nå."}
      </p>

      <div className="space-y-3">
        <QueueCard
          icon={FileText}
          title="CV-import"
          description="Roller, resultater, kompetanser og kvalifikasjoner fra CV-en, i fire trinn."
          count={cvCount}
          statusText={cvCount > 0 ? `${cvCount} venter` : "Ingenting venter"}
          action={
            <Button asChild size="sm" variant={cvCount > 0 ? "default" : "outline"}>
              <Link to="/forslag/cv">{cvCount > 0 ? "Fortsett" : "Åpne gjennomgang"}</Link>
            </Button>
          }
        />

        <QueueCard
          icon={Sparkles}
          title="Forslag fra analysen"
          description="Forslag utledet av kildene dine. Du godkjenner, korrigerer eller avviser hvert enkelt."
          count={aiCount}
          statusText={aiCount > 0 ? `${aiCount} venter` : "Ingenting venter"}
          action={
            <Button asChild size="sm" variant={aiCount > 0 ? "default" : "outline"}>
              <Link to="/forslag/ai">Åpne forslag</Link>
            </Button>
          }
        />

        <QueueCard
          icon={Building2}
          title="Arbeidsgiverdokumenter"
          description="Mål, resultater og tall fra medarbeidersamtaler, OKR, salgsmål og lignende."
          count={0}
          statusText="Kommer"
        />

        <QueueCard
          icon={Linkedin}
          title="LinkedIn"
          description="Forslag som venter på beslutning, er klare for overføring eller kan prøves på nytt. Importert innhold blir ikke brukerbekreftet av seg selv."
          count={linkedinCount}
          statusText={linkedinCount > 0 ? `${linkedinCount} venter` : "Ingenting venter"}
          action={
            linkedinCount > 0 ? (
              <Button asChild size="sm">
                <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
                  Åpne kildegjennomgang
                </Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                LinkedIn-eksporten lastes opp under «Legg til kilder».
              </p>
            )
          }
        />

        <QueueCard
          icon={GraduationCap}
          title="Kursbevis og sertifikater"
          description="Kvalifikasjoner fra kurs og sertifiseringer, med dokumentasjon."
          count={0}
          statusText="Kommer"
        />
      </div>
    </div>
  );
}
