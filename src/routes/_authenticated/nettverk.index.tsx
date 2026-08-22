// @ts-nocheck
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/nettverk/")({
  beforeLoad: () => {
    throw redirect({ to: "/nettverk/oversikt" });
  },
});
