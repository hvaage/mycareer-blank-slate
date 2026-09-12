// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicResults } from "@/lib/recruiter-survey.functions";
import { ResultsView } from "@/components/recruiter-survey/results-view";

const fullAccessMailto =
  "mailto:undersokelse@karrierenmin.no?subject=Foresp%C3%B8rsel%20om%20full%20tilgang%20til%20Rekruttererunders%C3%B8kelsen&body=Hei%2C%0A%0AJeg%20%C3%B8nsker%20tilgang%20til%20den%20fullstendige%20resultatsiden%20for%20Rekruttererunders%C3%B8kelsen.%0A%0AVennlig%20hilsen";

export const Route = createFileRoute("/rekruttererundersokelse/resultater/")({
  head: () => ({
    meta: [
      { title: "Resultater · Rekruttererundersøkelsen — Karrierenmin" },
      {
        name: "description",
        content: "Aggregerte resultater fra rekrutterere, headhuntere og Search-konsulenter.",
      },
      {
        property: "og:title",
        content: "Resultater · Rekruttererundersøkelsen — Karrierenmin",
      },
      {
        property: "og:description",
        content: "Aggregerte resultater fra rekrutterere, headhuntere og Search-konsulenter.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicResultsPage,
});

function PublicResultsPage() {
  const fetcher = useServerFn(getPublicResults);
  const { data, isLoading } = useQuery({
    queryKey: ["recruiter-results-public"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Aggregerte resultater · offentlig kortversjon
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {data?.version?.title ?? "Rekruttererundersøkelsen"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Dette er et utvalg av spørsmål som er publisert offentlig. Resultatene vises kun aggregert
          – enkeltsvar publiseres aldri uten godkjenning. Vil du ha full tilgang? Be om tilsendt
          resultatlenke.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/rekruttererundersokelse">Delta i undersøkelsen</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={fullAccessMailto}>Be om full tilgang</a>
          </Button>
        </div>

        {isLoading && <p className="mt-10 text-sm text-muted-foreground">Laster resultater…</p>}

        {!isLoading && data && (
          <div className="mt-10">
            {data.profile && data.profile.total === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">
                Ingen svar registrert ennå. Vær blant de første som bidrar.
              </Card>
            ) : (
              <ResultsView profile={data.profile} results={data.results} mode="public" />
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
