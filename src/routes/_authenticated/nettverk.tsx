// @ts-nocheck
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NetworkShell } from "@/components/network/network-shell";

export const Route = createFileRoute("/_authenticated/nettverk")({
  head: () => ({
    meta: [
      { title: "Nettverksarbeid | Karrierenmin" },
      {
        name: "description",
        content:
          "Arbeidsflate for selskaper, kontakter, muligheter og aktiviteter i ditt profesjonelle nettverk.",
      },
      { property: "og:title", content: "Nettverksarbeid | Karrierenmin" },
      {
        property: "og:description",
        content: "Selskaper, kontakter, muligheter og aktiviteter i ditt profesjonelle nettverk.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <NetworkShell>
      <Outlet />
    </NetworkShell>
  ),
});
