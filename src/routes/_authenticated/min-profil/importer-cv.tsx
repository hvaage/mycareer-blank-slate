// @ts-nocheck
// Gammel URL. Beholdes som redirect til «Legg til kilder».
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/min-profil/importer-cv")({
  beforeLoad: () => {
    throw redirect({ to: "/kilder", replace: true });
  },
});
