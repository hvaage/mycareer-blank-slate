import { createFileRoute, redirect } from "@tanstack/react-router";

// Kort, eksternt delbar adresse for rekruttererundersøkelsen.
export const Route = createFileRoute("/sporreskjema1")({
  head: () => ({
    meta: [{ title: "Spørreundersøkelse — Karrierenmin" }],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/rekruttererundersokelse" });
  },
});
