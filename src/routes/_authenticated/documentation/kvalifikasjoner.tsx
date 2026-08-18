// @ts-nocheck
/**
 * Språk, førerkort, sertifiseringer, vitnemål og verktøy i Min dokumentasjon.
 * Samme grunnlag som Erfaring og kompetanse — her med vekt på hva som er
 * dokumentert med en fil.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { DocumentationLayout } from "@/components/documentation/documentation-layout";
import { CredentialSections } from "@/components/career/credential-sections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/documentation/kvalifikasjoner")({
  head: () => ({
    meta: [
      { title: "Kvalifikasjoner og dokumentasjon | Karrieren min" },
      {
        name: "description",
        content:
          "Språk, førerkort, sertifiseringer, vitnemål og verktøy med opplastet dokumentasjon.",
      },
      { property: "og:title", content: "Kvalifikasjoner og dokumentasjon | Karrieren min" },
      {
        property: "og:description",
        content: "Se hva som er dokumentert med fil, og last opp det som mangler.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentationCredentialsPage,
});

function DocumentationCredentialsPage() {
  return (
    <DocumentationLayout>
      <div className="space-y-6">
        <Card className="max-w-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Kvalifikasjoner som kan dokumenteres</CardTitle>
            <CardDescription>
              Språk graderes, førerkort får klasse, og sertifiseringer og vitnemål kan lastes opp.
              Filene havner samtidig under Dokumenter.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/karriere/erfaring">Åpne Erfaring og kompetanse</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/documentation/library">Se alle dokumenter</Link>
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <CredentialSections />
        </div>
      </div>
    </DocumentationLayout>
  );
}
