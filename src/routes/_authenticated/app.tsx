import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppPage,
});

interface LinkedInData {
  profile_image_url: string;
  headline: string;
}

function AppPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [linkedin, setLinkedin] = useState<LinkedInData | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("km_linkedin");
    if (raw) {
      try {
        setLinkedin(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

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
        <h1 className="font-serif text-4xl text-foreground">Du er logget inn</h1>
        <p className="mt-3 text-base text-muted-foreground">{user?.email}</p>

        {linkedin && (
          <div className="mt-10 flex items-center gap-4 rounded-lg border border-border bg-card p-6">
            <img
              src={linkedin.profile_image_url}
              alt=""
              className="h-16 w-16 rounded-full object-cover"
            />
            <div>
              <p className="text-sm text-muted-foreground">Fra LinkedIn</p>
              <p className="text-lg text-foreground">{linkedin.headline}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
