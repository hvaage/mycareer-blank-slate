import { createFileRoute } from "@tanstack/react-router";
import { AboutMePage } from "@/components/pages/about-me-page";

export const Route = createFileRoute("/_authenticated/min-profil/opplysninger")({
  head: () => ({
    meta: [
      { title: "Profilopplysninger | Karrieren min" },
      { name: "description", content: "Rediger bakgrunn, jobbønsker og praktiske profilopplysninger." },
      { property: "og:title", content: "Profilopplysninger | Karrieren min" },
      { property: "og:description", content: "Rediger opplysningene som brukes i jobbsøk og søknadsarbeid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AboutMePage,
});