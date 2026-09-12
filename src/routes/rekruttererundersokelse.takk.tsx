import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import karrierenminLogo from "@/assets/karrierenmin-lockup.svg";
import { z } from "zod";

const search = z.object({ duplicate: z.coerce.number().optional() });

export const Route = createFileRoute("/rekruttererundersokelse/takk")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Takk for bidraget! — Karrierenmin" },
      {
        name: "description",
        content: "Takk for ditt anonyme bidrag til Rekruttererundersøkelsen fra Karrierenmin.",
      },
      { property: "og:title", content: "Takk for bidraget! — Karrierenmin" },
      {
        property: "og:description",
        content: "Takk for ditt anonyme bidrag til Rekruttererundersøkelsen fra Karrierenmin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TakkPage,
});

function TakkPage() {
  const { duplicate } = Route.useSearch();
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <img src={karrierenminLogo} alt="Karrierenmin" className="mx-auto h-auto w-56 max-w-full" />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {duplicate ? "Vi har registrert et tilsvarende svar nylig" : "Takk for bidraget!"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {duplicate
            ? "Det ser ut til at noen med samme oppsett har sendt inn nylig fra denne enheten. Hvis det ikke var deg, ta kontakt på hei@karrierenmin.no."
            : "Svaret ditt er lagret anonymt. Innsikten brukes til å utvikle bedre verktøy for jobbsøkere. Hvis du la igjen e-post, får du tilsendt resultatene når analysen er klar."}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/rekruttererundersokelse/resultater">Se foreløpige resultater</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Til forsiden</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
