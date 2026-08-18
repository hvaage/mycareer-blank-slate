import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Karriereprofil er slått sammen med Min profil.
 * Gammel sti beholdes som redirect slik at bokmerker og eksisterende lenker virker.
 */
export const Route = createFileRoute("/_authenticated/preferences")({
  beforeLoad: () => {
    throw redirect({ to: "/min-profil/karriereretning" });
  },
});
