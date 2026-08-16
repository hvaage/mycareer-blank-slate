import { createFileRoute } from "@tanstack/react-router";
import { ExperienceOverview } from "@/components/career/experience-overview";

export const Route = createFileRoute("/_authenticated/karriere/erfaring")({
  head: () => ({
    meta: [
      { title: "Erfaring og kompetanse | Karrieren min" },
      {
        name: "description",
        content:
          "Hierarkisk oversikt over roller, resultater og kompetansen de belegger i karriereprofilen din.",
      },
      { property: "og:title", content: "Erfaring og kompetanse | Karrieren min" },
      {
        property: "og:description",
        content: "Se hvilke roller og resultater kompetansen din hviler på.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ErfaringPage,
});

function ErfaringPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Erfaring og kompetanse</h1>
        <p className="text-sm text-muted-foreground">
          Grunnlaget ditt, i den rekkefølgen det henger sammen: rolle → resultat → kompetansen det
          belegger.
        </p>
      </header>
      <ExperienceOverview />
    </div>
  );
}
