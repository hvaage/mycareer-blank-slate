// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { CvReviewPage } from "@/components/pages/cv-review-page";

export const Route = createFileRoute("/_authenticated/forslag/cv")({
  head: () => ({
    meta: [
      { title: "Gjennomgå CV-import | Karrieren min" },
      {
        name: "description",
        content:
          "Se og bekreft hvert enkelt funn fra CV-importen. Du bestemmer hva som blir evidens i karriereprofilen din.",
      },
      { property: "og:title", content: "Gjennomgå CV-import | Karrieren min" },
      {
        property: "og:description",
        content: "Bekreft roller, resultater, kompetanser og kvalifikasjoner fra CV-en din.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { import?: string; legacy?: boolean } => ({
    import: typeof search["import"] === "string" ? (search["import"] as string) : undefined,
    legacy: search["legacy"] === true || search["legacy"] === "1" ? true : undefined,
  }),
  component: CvReviewPage,
});
