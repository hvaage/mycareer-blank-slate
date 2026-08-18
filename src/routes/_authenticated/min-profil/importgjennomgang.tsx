import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * «Importgjennomgang» heter nå «Importer eksisterende CV».
 * Gammel sti beholdes som redirect slik at lenker fortsatt virker.
 */
export const Route = createFileRoute("/_authenticated/min-profil/importgjennomgang")({
  beforeLoad: () => {
    throw redirect({ to: "/min-profil/importer-cv" });
  },
});
