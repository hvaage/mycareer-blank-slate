import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/glemt-passord")({
  head: () => ({
    meta: [
      { title: "Glemt passord | Karrierenmin" },
      {
        name: "description",
        content: "Få tilsendt en lenke for å sette nytt passord til Karrierenmin-kontoen din.",
      },
      { property: "og:title", content: "Glemt passord | Karrierenmin" },
      { property: "og:description", content: "Sett nytt passord til Karrierenmin-kontoen din." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/nytt-passord`,
    });
    setLoading(false);
    if (resetError && resetError.status !== 400) {
      setError("Vi klarte ikke å sende lenken akkurat nå. Prøv igjen om litt.");
      return;
    }
    // Nøytralt svar: vi avslører ikke hvilke e-postadresser som er registrert.
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center font-serif text-2xl text-foreground">
          Karrierenmin
        </Link>
        <div className="mt-10 rounded-lg border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl text-foreground">Glemt passord</h1>

          {sent ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Hvis adressen finnes hos oss, har vi sendt en lenke for å sette nytt passord.
                Sjekk innboksen — og søppelposten — om et par minutter.
              </p>
              <Button asChild variant="outline" className="mt-6 w-full">
                <Link to="/login">Tilbake til innlogging</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Skriv inn e-postadressen din, så sender vi deg en lenke for å sette nytt passord.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-post</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sender…" : "Send lenke"}
                </Button>
              </form>
              <p className="mt-6 text-center text-sm text-muted-foreground">
                <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
                  Tilbake til innlogging
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
