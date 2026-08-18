// @ts-nocheck
// Gammel URL. Beholdes som redirect med bevart import-/query-kontekst.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/career/cv-review")({
  validateSearch: (search: Record<string, unknown>): { import?: string; legacy?: boolean } => ({
    import: typeof search["import"] === "string" ? (search["import"] as string) : undefined,
    legacy: search["legacy"] === true || search["legacy"] === "1" ? true : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/forslag/cv", search, replace: true });
  },
});
