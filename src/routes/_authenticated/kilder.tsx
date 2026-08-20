// @ts-nocheck
// ============================================================
// Legg til kilder — alt grunnlag karriereoversikten bygges fra.
// Ditt eget grunnlag kan belegge påstander. Referansegrunnlag
// foreslår formuleringer, men gir aldri belegg.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useProfileOverviewData } from "@/lib/queries/profile-overview";
import { AboutMeCvSection } from "@/components/cv-upload/about-me-section";
import { FileText, Linkedin, GraduationCap, BookOpen, Layers, Building2, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/kilder")({
  head: () => ({
    meta: [
      { title: "Legg til kilder | Karrieren min" },
      {
        name: "description",
        content:
          "Tilfør grunnlag til karriereoversikten: eksisterende CV, arbeidsgiverdokumenter, LinkedIn, kursbevis og referansekilder.",
      },
      { property: "og:title", content: "Legg til kilder | Karrieren min" },
      {
        property: "og:description",
        content: "Kilder er materialet vi bygger karriereoversikten din fra.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KilderPage,
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
  statusTone?: "muted" | "attention";
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

function KilderPage() {
  const { user } = useAuth();
  const { atoms, pending } = useProfileOverviewData(user?.id ?? "");

  if (!user) return null;

  const needsReview = pending.pendingCandidates > 0 || pending.openImports > 0;
  const qualifications = atoms?.qualifications ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Legg til kilder</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Kilder er materialet vi bygger karriereoversikten din fra. Alt du legger inn her blir
          forslag som du bekrefter i gjennomgangen.
        </p>
      </header>

      <Card className="border-muted-foreground/20 bg-muted/30">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="max-w-prose text-muted-foreground">
            Filer du legger inn her lagres som kildedokumenter og vises under{" "}
            <Link to="/documentation/cv" className="underline underline-offset-2">
              Min dokumentasjon
            </Link>
            . Søknadsklare dokumenter lager du under{" "}
            <Link to="/soknadsdokumenter" className="underline underline-offset-2">
              Søknader
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Ditt eget grunnlag</h2>
          <p className="text-sm text-muted-foreground">
            Dette kan belegge påstander i CV og søknader.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <CardTitle className="text-base">Eksisterende CV</CardTitle>
                <CardDescription className="max-w-prose">
                  Vi bruker CV-en til å bygge karriereoversikten din. Den brukes ikke som vedlegg i
                  søknader.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <AboutMeCvSection userId={user.id} />
          </CardContent>
        </Card>

        <SourceCard
          icon={Building2}
          title="Arbeidsgiverdokumenter"
          description="Medarbeidersamtaler, 1-til-1, KSO, OKR, salgsmål, prosjektbeskrivelser, kvartalsmål og årsbudsjett — med oppnådd resultat og dokumentasjon."
          status="Kommer"
        />

        <SourceCard
          icon={Linkedin}
          title="LinkedIn-import"
          description="Profil og LinkedIn Skills. Eksporten blir aldri overført automatisk: du får forslag du selv tar stilling til i kildegjennomgangen."
          status="Kommer"
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
                Se kildegjennomgang
              </Link>
            </Button>
          }
        />

        <SourceCard
          icon={BookOpen}
          title="Kursbevis og sertifikater"
          description="Kurs og sertifiseringer registreres som kvalifikasjoner og kan dokumenteres med kursbevis."
          status={qualifications.length > 0 ? `${qualifications.length} registrert` : "Mangler"}
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/documentation/kvalifikasjoner">Se kvalifikasjoner</Link>
            </Button>
          }
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-muted-foreground">
            Referansegrunnlag
          </h2>
          <p className="text-sm text-muted-foreground">
            Foreslår formuleringer og standardnavn. Gir ikke belegg for at du har kompetansen.
          </p>
        </div>

        <SourceCard
          icon={Layers}
          title="Yrkes- og kompetansereferanser (ESCO)"
          description="Standardiserte kompetanser knyttet til yrke og stillingstittel."
          status="Kommer"
        />

        <SourceCard
          icon={GraduationCap}
          title="Utdanningsreferanser"
          description="Utdanning gir kvalifikasjoner direkte, og kan foreslå fagkompetanser som må bekreftes."
          status="Kommer"
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/karriere/erfaring">Registrer utdanning</Link>
            </Button>
          }
        />
      </section>

      <Card className={needsReview ? "border-primary/40" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Neste steg</CardTitle>
          <CardDescription>
            {needsReview
              ? "Du har importert innhold som venter på gjennomgang."
              : "Når du har lagt til en kilde, går du gjennom forslagene."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button asChild size="sm" variant={needsReview ? "default" : "outline"}>
            <Link to="/forslag">Gjennomgå forslag</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
