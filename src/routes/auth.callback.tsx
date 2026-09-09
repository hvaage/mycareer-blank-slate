import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { getPostLoginRedirect } from "@/lib/post-login-redirect";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const rawHash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(rawHash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      // MERK: her logges det bevisst ingenting. Adresse, spørrestreng,
      // kode, state og tokener er legitimasjon og skal aldri i konsollen.


      try {
        let session: { user?: { id?: string } } | null = null;

        if (accessToken && refreshToken) {
          const { data, error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setErr) {
            console.error("innlogging: kunne ikke etablere økt", setErr?.message);
            if (!cancelled) setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
            return;
          }
          session = data.session;
          history.replaceState(null, "", window.location.pathname);
        } else if (code) {
          const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeErr) {
            console.error("innlogging: utveksling feilet", exchangeErr?.message);
            if (!cancelled) setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
            return;
          }
          session = data.session;
        }

        if (!session) {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            console.error("innlogging: oppslag av økt feilet", sessionError?.message);
          }
          session = sessionData?.session ?? null;
        }


        if (cancelled) return;

        const userId = session?.user?.id;
        if (!userId) {
          setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
          return;
        }

        // Kom brukeren hit midt i en tilkobling av en KI-assistent, sendes
        // hen tilbake dit. Tilstanden er signert og verifiseres server-side
        // mot en allowliste — aldri en rå adresse fra nettleseren.
        const pendingOauth = sessionStorage.getItem("km_oauth_return");
        if (pendingOauth) {
          sessionStorage.removeItem("km_oauth_return");
          const resolved = await fetch("/api/public/oauth/return", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: pendingOauth }),
          })
            .then((r) => r.json())
            .catch(() => null);
          if (!cancelled && resolved?.ok && typeof resolved.path === "string") {
            window.location.assign(resolved.path);
            return;
          }
        }

        const target = await getPostLoginRedirect(userId);
        if (cancelled) return;
        navigate({ to: target, replace: true });
      } catch (e) {
        if (cancelled) return;
        console.error("innlogging: uventet feil", (e as Error)?.message);
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-sm shadow-sm">
        <h1 className="text-xl text-foreground">Logger inn…</h1>
        {error ? (
          <>
            <p className="mt-3 text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/login", replace: true })}
              className="mt-6 text-foreground underline"
            >
              Tilbake til innlogging
            </button>
          </>
        ) : (
          <p className="mt-3 text-muted-foreground">Et øyeblikk mens vi etablerer økten.</p>
        )}
      </div>
    </main>
  );
}
