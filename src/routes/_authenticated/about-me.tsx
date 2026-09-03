// @ts-nocheck
// Gammel URL. Redigering av profilopplysninger har egen underside.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/about-me")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? (search.tab as string) : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/min-profil/opplysninger", search, replace: true });
  },
});
