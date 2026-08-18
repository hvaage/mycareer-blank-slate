// @ts-nocheck
// ============================================================
// Min profil — her redigerer brukeren det han selv oppgir om seg.
// Statusbokser og gjentatte oppsummeringer er fjernet: den
// informasjonen eies av Karriereoversikt, Min dokumentasjon og
// Gjennomgå forslag, og redigeres der.
// ============================================================
import { createFileRoute } from "@tanstack/react-router";
import { AboutMePage } from "@/components/pages/about-me-page";

export const Route = createFileRoute("/_authenticated/min-profil/")({
  head: () => ({
    meta: [
      { title: "Min profil | Karrieren min" },
      {
        name: "description",
        content:
          "Rediger det du selv oppgir om deg: kort om meg, karriereretning, jobbønsker og preferanser.",
      },
      { property: "og:title", content: "Min profil | Karrieren min" },
      {
        property: "og:description",
        content: "Dine egne opplysninger, samlet ett sted og redigerbare.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? (search.tab as string) : undefined,
  }),
  component: AboutMePage,
});
