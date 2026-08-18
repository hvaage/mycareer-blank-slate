// @ts-nocheck
// ============================================================
// Søknader → Lag søknadsdokumenter
// Én inngang til de tre dokumentene som faktisk kan sendes med
// en søknad: generell CV, stillingstilpasset CV og søknadsbrev.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Mail, Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/soknadsdokumenter")({
  head: () => ({
    meta: [
      { title: "Lag søknadsdokumenter — Karrierenmin" },
      {
        name: "description",
        content:
          "Lag generell CV, stillingstilpasset CV og søknadsbrev fra den bekreftede karriereoversikten din.",
      },
      { property: "og:title", content: "Lag søknadsdokumenter — Karrierenmin" },
      {
        property: "og:description",
        content: "Søknadsklare dokumenter bygget på bekreftet karriereoversikt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SoknadsdokumenterPage,
});

function DocCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  to,
  search,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  actionLabel: string;
  to: string;
  search?: Record<string, unknown>;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="max-w-prose">{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Button asChild size="sm">
          <Link to={to} search={search as never}>
            {actionLabel}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SoknadsdokumenterPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Lag søknadsdokumenter</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Dokumentene her bygges på den bekreftede karriereoversikten din, og er de eneste som er
          ment å sendes med søknader. Importerte kilde-CV-er brukes bare som grunnlag.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <DocCard
          icon={FileText}
          title="Generell CV"
          description="Én CV på norsk eller engelsk som dekker hele bakgrunnen din."
          actionLabel="Lag generell CV"
          to="/cv-builder"
          search={{ type: "general" }}
        />
        <DocCard
          icon={Target}
          title="Stillingstilpasset CV"
          description="CV tilpasset kravene og nøkkelordene i én konkret utlysning."
          actionLabel="Lag tilpasset CV"
          to="/cv-builder"
          search={{ type: "tailored" }}
        />
        <DocCard
          icon={Mail}
          title="Søknadsbrev"
          description="Brev skrevet mot stillingen, med utgangspunkt i erfaringen du har bekreftet."
          actionLabel="Lag søknadsbrev"
          to="/cover-letters"
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6 text-sm">
          <span className="text-muted-foreground">Ferdige dokumenter finner du under</span>
          <Button asChild size="sm" variant="outline">
            <Link to="/documentation/cv">Min dokumentasjon → CV-er</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/documentation/soknadsbrev">Søknadsbrev</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
