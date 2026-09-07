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
    <main className="min-h-screen">
      <CareerExplorer />

      {/* Kildevisning: Universum brukes kun i arbeidsgiverinnsikt */}
      <section className="mx-auto max-w-3xl px-4 pb-16">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Om Universum som kilde
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Universums årlige måling av hvilke arbeidsgivere studenter helst vil jobbe
            hos inngår i <strong className="font-medium text-foreground">Arbeidsgiverinnsikt</strong>.
            Der vises plasseringen på arbeidsgiverens egen side når vi har et entydig
            treff mot den juridiske enheten.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Dette er en preferansemåling blant studenter — ikke en kvalitetsvurdering av
            arbeidsgiveren. Universum-data inngår ikke i yrkes- og kompetanseanalysen på
            denne siden, og brukes ikke som karrieresignal.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Kilde:{" "}
            <a
              href="https://universumglobal.com/rankings/?tab=country&market=norway&year=2026&mainfield=it&surveyType=ss"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Universum Most Attractive Employers
            </a>
            . Gratis tilgang krever registrering med jobb-e-post; dypere innsikt er
            kommersiell.
          </p>
        </div>
      </section>
    </main>
  );
}

