import { createFileRoute } from "@tanstack/react-router";
import { CareerExplorer } from "@/components/market/CareerExplorer";

export const Route = createFileRoute("/markedsinnsikt")({
  head: () => ({
    meta: [
      {
        title:
          "Markedsinnsikt — utforsk yrker, kompetanse og arbeidsmarked | Karrierenmin",
      },
      {
        name: "description",
        content:
          "Søk på en stilling og se markedssignaler, må-ha-kompetanser, lønn, relevante bransjer og nærliggende karriereveier — basert på åpne data fra ESCO, SSB, NAV og NHO.",
      },
      {
        property: "og:title",
        content: "Markedsinnsikt — Karrierenmin",
      },
      {
        property: "og:description",
        content:
          "Et åpent verktøy for å utforske arbeidsmarked, kompetansekrav og karriereveier i Norge.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:url",
        content: "https://karrierenmin.no/markedsinnsikt",
      },
    ],
    links: [
      { rel: "canonical", href: "https://karrierenmin.no/markedsinnsikt" },
    ],
  }),
  component: MarkedsinnsiktPage,
});

function MarkedsinnsiktPage() {
  return (
    <main className="km-scope min-h-screen">
      <CareerExplorer />
    </main>
  );
}
