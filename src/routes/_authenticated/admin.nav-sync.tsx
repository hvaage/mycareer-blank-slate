import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias: /admin/nav-sync -> /admin/sync?tab=nav (M5.7)
export const Route = createFileRoute("/_authenticated/admin/nav-sync")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/sync", search: { tab: "nav" } });
  },
  component: () => null,
});
