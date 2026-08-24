import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/nytt-passord")({
  head: () => ({
    meta: [
      { title: "Sett nytt passord | Karrierenmin" },
      {
        name: "description",
        content: "Velg et nytt passord til Karrierenmin-kontoen din.",
      },
      { property: "og:title", content: "Sett nytt passord | Karrierenmin" },
      { property: "og:description", content: "Velg et nytt passord til Karrierenmin-kontoen din." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewPasswordPage,
});

type Phase = "verifiserer" | "klar" | "ugyldig";

function NewPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("verifiserer");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const rawHash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(rawHash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = url.searchParams.get("code");

      try {
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          history.replaceState(null, "", window.location.pathname);
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          history.replaceState(null, "", window.location.pathname);
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setPhase(data.session ? "klar" : "ugyldig");
      } catch {
        if (!cancelled) setPhase("ugyldig");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) {
      toast.error("Passordet må være minst 8 tegn");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("Passordene er ikke like");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      toast.success("Passord oppdatert");
      navigate({ to: "/auth/callback", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Kunne ikke oppdatere passord");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center font-serif text-2xl text-foreground">
          Karrierenmin
        </Link>
        <div className="mt-10 rounded-lg border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl text-foreground">Sett nytt passord</h1>

          {phase === "verifiserer" && (
            <p className="mt-3 text-sm text-muted-foreground">Sjekker lenken…</p>
          )}

          {phase === "ugyldig" && (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Lenken er ugyldig eller utløpt. Be om en ny lenke for å sette nytt passord.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link to="/glemt-passord">Be om ny lenke</Link>
              </Button>
            </>
          )}

          {phase === "klar" && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pwd">Nytt passord</Label>
                <Input
                  id="pwd"
                  type="password"
                  autoComplete="new-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pwd2">Bekreft passord</Label>
                <Input
                  id="pwd2"
                  type="password"
                  autoComplete="new-password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Lagrer…" : "Lagre nytt passord"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
