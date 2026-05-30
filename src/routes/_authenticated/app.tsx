import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppPage,
});

function AppPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email ??
    "";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="font-serif text-xl text-foreground">Karrierenmin</span>
          <Button size="sm" variant="outline" onClick={handleLogout}>
            Logg ut
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-serif text-4xl text-foreground">Velkommen tilbake</h1>
        {displayName && (
          <p className="mt-3 text-base text-muted-foreground">{displayName}</p>
        )}
        <p className="mt-10 text-sm text-muted-foreground">
          Mer innhold kommer snart.
        </p>
      </main>
    </div>
  );
}
