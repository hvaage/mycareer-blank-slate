// @ts-nocheck
import { createFileRoute, redirect } from "@tanstack/react-router";

// Flyttet til Innstillinger → Integrasjoner. Beholdes som redirect for gamle lenker.
export const Route = createFileRoute("/_authenticated/integrations")({
  beforeLoad: () => {
    throw redirect({ to: "/innstillinger/integrasjoner", replace: true });
  },
});
