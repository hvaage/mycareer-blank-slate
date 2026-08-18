// @ts-nocheck
// Gammel URL. «Om meg» ligger nå på Min profil.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/about-me")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? (search.tab as string) : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/min-profil", search, replace: true });
  },
});
