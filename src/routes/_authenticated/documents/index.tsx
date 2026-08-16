import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Dokumentlisten er slått sammen med Min dokumentasjon.
 * Gammel sti beholdes som redirect slik at eksisterende lenker fortsatt virker.
 */
export const Route = createFileRoute("/_authenticated/documents/")({
  beforeLoad: () => {
    throw redirect({ to: "/documentation/library" });
  },
});
