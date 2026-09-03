// @ts-nocheck
// ============================================================
// Min profil — overordnet dashboard for hele «Min karriere».
// ============================================================
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProfileDashboardPage } from "@/components/pages/profile-dashboard-page";

export const Route = createFileRoute("/_authenticated/min-profil/")({
  head: () => ({
    meta: [
      { title: "Min profil | Karrieren min" },
      {
        name: "description",
        content:
          "Se stilling, karrieregrunnlag, kompetanser og hva som bør oppdateres videre.",
      },
      { property: "og:title", content: "Min profil | Karrieren min" },
      {
        property: "og:description",
        content: "Din samlede karriereprofil og inngang til alle deler av Min karriere.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? (search.tab as string) : undefined,
  }),
  // CV-opplasting bor nå bare under «Legg til kilder».
  beforeLoad: ({ search }) => {
    if (search.tab === "karriereoversikt" || search.tab === "cv") {
      throw redirect({ to: "/kilder", replace: true });
    }
  },
  component: ProfileDashboardPage,
});
