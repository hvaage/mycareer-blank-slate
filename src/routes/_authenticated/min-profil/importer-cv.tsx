// @ts-nocheck
// ============================================================
// Importer eksisterende CV — eneste sted for å laste opp en CV
// som kilde til karriereoversikten. Filen blir ikke en søknadsklar
// CV; søknadsdokumenter lages under Søknader.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useProfileOverviewData } from "@/lib/queries/profile-overview";
import { AboutMeCvSection } from "@/components/cv-upload/about-me-section";
import { FileText, Linkedin, GraduationCap, BookOpen, Layers, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/min-profil/importer-cv")({
  head: () => ({
    meta: [
      { title: "Importer eksisterende CV — Karrierenmin" },
      {
        name: "description",
        content:
          "Last opp en eksisterende CV som kilde til karriereoversikten, og se status for import fra LinkedIn, utdanning og kurs.",
      },
      { property: "og:title", content: "Importer eksisterende CV — Karrierenmin" },
      {
        property: "og:description",
        content: "CV-en brukes som kilde til karriereoversikten, ikke som vedlegg i søknader.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImporterCvPage,
});

function SourceCard({
  icon: Icon,
  title,
  description,
  status,
  statusTone = "muted",
  actions,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  status: string;
  statusTone?: "muted" | "attention" | "ok";
  actions?: React.ReactNode;
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
          <Badge
            variant={statusTone === "attention" ? "default" : "secondary"}
            className="shrink-0 font-normal"
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      {actions ? <CardContent className="flex flex-wrap gap-2 pt-0">{actions}</CardContent> : null}
    </Card>
  );
}

function ImporterCvPage() {
  const { user } = useAuth();
  const { atoms, pending } = useProfileOverviewData(user?.id ?? "");

  if (!user) return null;

  const needsReview = pending.pendingCandidates > 0 || pending.openImports > 0;
  const qualifications = atoms?.qualifications ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Importer eksisterende CV</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Vi bruker CV-en som kilde for å bygge karriereoversikten. Den blir ikke brukt som vedlegg i
          søknader før du har laget en ny, søknadsklar CV.
        </p>
      </header>

      <Card className="border-muted-foreground/20 bg-muted/30">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="max-w-prose text-muted-foreground">
            Filer du laster opp her lagres som kildedokumenter. De vises under{" "}
            <Link to="/documentation/cv" className="underline underline-offset-2">
              Min dokumentasjon → CV-er
            </Link>{" "}
            merket «Ikke for innsending». Søknadsklare CV-er lager du under{" "}
            <Link to="/soknadsdokumenter" className="underline underline-offset-2">
              Søknader → Lag søknadsdokumenter
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <AboutMeCvSection userId={user.id} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Andre kilder</h2>

        <SourceCard
          icon={FileText}
          title="CV-gjennomgang"
          description="Gå gjennom roller, resultater, kompetanser og kvalifikasjoner fra importen i fire trinn."
          status={
            needsReview
              ? pending.pendingCandidates > 0
                ? `${pending.pendingCandidates} venter`
                : "Import ikke fullført"
              : "Ingenting venter"
          }
          statusTone={needsReview ? "attention" : "muted"}
          actions={
            <Button asChild size="sm" variant={needsReview ? "default" : "outline"}>
              <Link to="/career/cv-review">Åpne CV-gjennomgang</Link>
            </Button>
          }
        />

        <SourceCard
          icon={Linkedin}
          title="LinkedIn"
          description="Importer profil og LinkedIn Skills. Ferdigheter fra LinkedIn behandles som forslag og må belegges mot roller eller resultater."
          status="Importer"
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/innstillinger/integrasjoner">Åpne integrasjoner</Link>
            </Button>
          }
        />

        <SourceCard
          icon={Layers}
          title="Generelle stillingskompetanser (ESCO)"
          description="Standardiserte kompetanser knyttet til yrke og stillingstittel. Kommer som eget importsteg."
          status="Kommer"
        />

        <SourceCard
          icon={GraduationCap}
          title="Utdanningsretninger og kompetanser"
          description="Utdanning gir kvalifikasjoner direkte, og kan foreslå fagkompetanser som må bekreftes."
          status={qualifications.length > 0 ? `${qualifications.length} registrert` : "Mangler"}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/karriere/erfaring">Registrer utdanning</Link>
            </Button>
          }
        />

        <SourceCard
          icon={BookOpen}
          title="Kurs og sertifiseringer"
          description="Kurs og sertifiseringer registreres som kvalifikasjoner og kan dokumenteres med kursbevis."
          status="Kommer"
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/documentation/kvalifikasjoner">Se kvalifikasjoner</Link>
            </Button>
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Forslag fra importkilder er merket som forslag til du bekrefter dem i gjennomgangen.
      </p>
    </div>
  );
}
