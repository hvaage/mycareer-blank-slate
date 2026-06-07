// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getFullResults } from "@/lib/recruiter-survey.functions";
import { ResultsView } from "@/components/recruiter-survey/results-view";

const search = z.object({ token: z.string().optional() });

export const Route = createFileRoute("/rekruttererundersokelse/resultater/full")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Full resultatside · Rekruttererundersøkelsen — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FullResultsPage,
});

function FullResultsPage() {
  const { token } = Route.useSearch();
  const fetcher = useServerFn(getFullResults);
  const { data, isLoading, error } = useQuery({
    queryKey: ["recruiter-results-full", token ?? "admin"],
    queryFn: () => fetcher({ data: { token: token ?? null } }),
    retry: false,
    staleTime: 30_000,
  });

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-xl px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold">Tilgang kreves</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Denne resultatsiden krever en gyldig tilgangslenke eller administrator-innlogging.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild>
              <Link to="/rekruttererundersokelse/resultater">Se offentlige resultater</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href="mailto:hei@karrierenmin.no?subject=Tilgang%20til%20full%20resultatside">
                Be om tilgang
              </a>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Full resultatside · {token ? "tilgangslenke" : "administrator"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {data?.version?.title ?? "Rekruttererundersøkelsen"}
        </h1>

        {isLoading && (
          <p className="mt-10 text-sm text-muted-foreground">Laster resultater…</p>
        )}

        {!isLoading && data && (
          <div className="mt-10">
            {data.profile && data.profile.total === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">
                Ingen svar registrert ennå.
              </Card>
            ) : (
              <ResultsView profile={data.profile} results={data.results} mode="full" />
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
