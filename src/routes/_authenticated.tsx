import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Laster…</p>
      </div>
    );
  }

  if (!session) {
    const redirectTo = `${location.pathname}${location.searchStr ?? ""}`;
    return (
      <Navigate
        to="/login"
        search={{ redirect: redirectTo }}
        replace
      />
    );
  }

  return <Outlet />;
}
