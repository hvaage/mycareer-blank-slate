import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authReady } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";


export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
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
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center gap-2 border-b px-2">
            <span className="sm:hidden">
              <SidebarTrigger />
            </span>
            <span className="text-sm font-semibold sm:hidden">Karrierenmin</span>
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>

          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
