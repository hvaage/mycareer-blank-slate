// @ts-nocheck
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NetworkShell } from "@/components/network/network-shell";

export const Route = createFileRoute("/_authenticated/nettverk")({
  head: () => ({
    meta: [
      { title: "Nettverk og muligheter | Karrierenmin" },
      {
        name: "description",
        content:
          "Arbeidsflate for selskaper og kontakter i ditt profesjonelle nettverk, koblet til dine muligheter.",
      },
      { property: "og:title", content: "Nettverk og muligheter | Karrierenmin" },
      {
        property: "og:description",
        content: "Selskaper og kontakter i ditt profesjonelle nettverk.",
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
