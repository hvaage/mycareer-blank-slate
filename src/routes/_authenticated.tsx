import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authReady } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // SSR: do nothing — let the client gate this route.
    if (typeof window === "undefined") return;

    await authReady;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: `${location.pathname}${location.searchStr ?? ""}` },
      });
    }
  },
  component: () => <Outlet />,
});
