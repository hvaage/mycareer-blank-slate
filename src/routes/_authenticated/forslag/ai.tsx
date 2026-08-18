// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { AtomReviewPage } from "@/components/pages/atom-review-page";

export const Route = createFileRoute("/_authenticated/forslag/ai")({
  head: () => ({
    meta: [
      { title: "AI-forslag til gjennomgang | Karrieren min" },
      {
        name: "description",
        content:
          "Vurder forslag fra analysen. Ingenting blir en del av karriereoversikten før du bekrefter det.",
      },
      { property: "og:title", content: "AI-forslag til gjennomgang | Karrieren min" },
      {
        property: "og:description",
        content: "Godkjenn, korriger eller avvis forslag fra analysen av kildene dine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AtomReviewPage,
});
