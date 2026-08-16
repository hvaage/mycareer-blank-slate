// @ts-nocheck
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/innstillinger/")({
  beforeLoad: () => {
    throw redirect({ to: "/innstillinger/integrasjoner", replace: true });
  },
});
