// GET /oauth/authorize — norsk samtykkeside.
//
// Siden viser bare. Selve godkjenningen og avvisningen skjer med POST
// mot /api/oauth/consent, aldri med GET, og alltid med CSRF-token.
// Ingen kode eller token havner noen gang i denne sidens URL.

import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/landing/Logo";

type ScopeInfo = { scope: string; description: string };
type Integration = { id: string; provider: string; status: string };

export const Route = createFileRoute("/oauth/authorize")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Koble til assistent | Karrierenmin" },
      {
        name: "description",
        content:
          "Godkjenn at en KI-assistent får tilgang til karrierearbeidet ditt i Karrierenmin.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthorizePage,
});

const RETURN_KEY = "km_oauth_return";

function AuthorizePage() {
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [requestToken, setRequestToken] = useState("");
  const [csrf, setCsrf] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const prepared = await fetch("/api/public/oauth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: params.get("response_type"),
          client_id: params.get("client_id"),
          redirect_uri: params.get("redirect_uri"),
          scope: params.get("scope"),
          state: params.get("state"),
          resource: params.get("resource"),
          code_challenge: params.get("code_challenge"),
          code_challenge_method: params.get("code_challenge_method"),
          return_path: window.location.pathname + window.location.search,
        }),
      }).then((r) => r.json());

      if (cancelled) return;
      if (!prepared?.ok) {
        if (prepared?.redirect_url) {
          window.location.assign(prepared.redirect_url);
          return;
        }
        setLoading(false);
        setError(prepared?.description ?? "Forespørselen er ikke gyldig.");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        // Signert, kortlivet returtilstand — ikke en rå adresse.
        if (prepared.return_state) sessionStorage.setItem(RETURN_KEY, prepared.return_state);
        window.location.assign("/login");
        return;
      }

      const consent = await fetch(
        `/api/oauth/consent?request_token=${encodeURIComponent(prepared.request_token)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then((r) => r.json());

      if (cancelled) return;
      setLoading(false);
      if (!consent?.ok) {
        setError("Vi klarte ikke å hente forespørselen. Prøv å koble til på nytt.");
        return;
      }
      setRequestToken(prepared.request_token);
      setClientName(consent.client_name);
      setScopes(consent.scopes ?? []);
      setCsrf(consent.csrf_token);
      setIntegrations(consent.integrations ?? []);
      if ((consent.integrations ?? []).length === 1) setChosen(consent.integrations[0].id);
    };

    run().catch(() => {
      if (!cancelled) {
        setLoading(false);
        setError("Noe gikk galt. Prøv igjen.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setBusy(false);
      setError("Du er logget ut. Logg inn og prøv igjen.");
      return;
    }
    const result = await fetch("/api/oauth/consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-oauth-csrf": csrf,
      },
      body: JSON.stringify({
        request_token: requestToken,
        decision,
        integration_id: chosen || undefined,
      }),
    }).then((r) => r.json());

    if (!result?.ok || !result.redirect_url) {
      setBusy(false);
      setError(result?.error?.message ?? "Vi klarte ikke å fullføre. Prøv igjen.");
      return;
    }
    window.location.assign(result.redirect_url);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="flex justify-center">
          <Logo className="block h-10 w-auto" />
        </div>
        <div className="mt-10 rounded-lg border border-border bg-card p-8 shadow-sm">
          {loading ? (
            <p className="text-sm text-muted-foreground">Henter forespørselen…</p>
          ) : error ? (
            <>
              <h1 className="text-2xl text-foreground">Tilkoblingen kan ikke fullføres</h1>
              <p className="mt-3 text-sm text-destructive">{error}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl text-foreground">Vil du koble til {clientName}?</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {clientName} ber om tilgang til karrierearbeidet ditt i Karrierenmin. Du kan når
                som helst koble fra igjen under Innstillinger.
              </p>

              <h2 className="mt-6 text-sm font-medium text-foreground">Dette gir du tilgang til</h2>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {scopes.map((s) => (
                  <li key={s.scope} className="rounded-md border border-border p-3">
                    {s.description}
                  </li>
                ))}
              </ul>

              {integrations.length > 1 && (
                <div className="mt-6">
                  <h2 className="text-sm font-medium text-foreground">Hvilken assistent gjelder det?</h2>
                  <div className="mt-2 space-y-2">
                    {integrations.map((i) => (
                      <label
                        key={i.id}
                        className="flex items-center gap-3 rounded-md border border-border p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name="integration"
                          value={i.id}
                          checked={chosen === i.id}
                          onChange={() => setChosen(i.id)}
                        />
                        <span className="text-foreground">{i.provider}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {integrations.length === 0 && (
                <p className="mt-6 text-sm text-destructive">
                  Du har ingen aktiv assistent å koble til. Legg til én under Innstillinger først.
                </p>
              )}

              <div className="mt-8 flex gap-3">
                <Button
                  type="button"
                  onClick={() => decide("approve")}
                  disabled={busy || integrations.length === 0 || (integrations.length > 1 && !chosen)}
                >
                  {busy ? "Et øyeblikk…" : "Godkjenn"}
                </Button>
                <Button type="button" variant="outline" onClick={() => decide("deny")} disabled={busy}>
                  Avslå
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
