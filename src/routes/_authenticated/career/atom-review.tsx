// @ts-nocheck
// Gammel URL. Beholdes som redirect til den samlede gjennomgangen.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/career/atom-review")({
  beforeLoad: () => {
    throw redirect({ to: "/forslag/ai", replace: true });
  },
});
