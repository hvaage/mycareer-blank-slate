import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleLinkedIn = async () => {
    setError(null);
    setLinkedinLoading(true);
    const state = crypto.randomUUID();
    sessionStorage.setItem("linkedin_oauth_state", state);
    const redirectUri = window.location.origin + "/auth/linkedin-callback";
    const { data, error } = await supabase.functions.invoke("linkedin-start", {
      body: { redirect_uri: redirectUri, state },
    });
    if (error || !data?.authorization_url) {
      setLinkedinLoading(false);
      setError(data?.error ?? "Kunne ikke starte LinkedIn-innlogging");
      return;
    }
    window.location.href = data.authorization_url;
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth/callback",
    });
    if (result.error) {
      setGoogleLoading(false);
      setError("Kunne ikke opprette konto med Google");
      return;
    }
    if (result.redirected) return;
    if (result.tokens) {
      const { error: setErr } = await supabase.auth.setSession(result.tokens);
      if (setErr) {
        setGoogleLoading(false);
        setError("Kunne ikke fullføre Google-innlogging");
        return;
      }
    }
    navigate({ to: "/auth/callback", replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: "https://karrierenmin.no/auth/callback" },
    });
    setLoading(false);
    if (error) {
      setError("Kunne ikke opprette konto");
      return;
    }
    if (data.session) {
      navigate({ to: "/auth/callback", replace: true });
    } else {
      setInfo("Sjekk e-posten din for å fullføre registreringen");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center font-serif text-2xl text-foreground">
          Karrierenmin
        </Link>
        <div className="mt-10 rounded-lg border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl text-foreground">Opprett konto</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Du kan koble til LinkedIn og andre kilder senere.
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-6 w-full"
            onClick={handleGoogle}
            disabled={googleLoading || linkedinLoading || loading}
          >
            {googleLoading ? "Åpner Google…" : "Fortsett med Google"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            onClick={handleLinkedIn}
            disabled={googleLoading || linkedinLoading || loading}
          >
            {linkedinLoading ? "Åpner LinkedIn…" : "Fortsett med LinkedIn"}
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            eller
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
            <div className="space-y-2">
              <Label htmlFor="password">Passord</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Button type="submit" className="w-full" disabled={loading || googleLoading || linkedinLoading}>
              {loading ? "Oppretter konto…" : "Opprett konto med e-post"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Har du allerede konto?{" "}
            <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
              Logg inn
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
