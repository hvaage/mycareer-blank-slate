import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/linkedin-callback")({
  component: LinkedInCallback,
});

function LinkedInCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Logger inn med LinkedIn…");
  const [debugRedirectUri, setDebugRedirectUri] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");
      const oauthErrorDesc = url.searchParams.get("error_description");
      const redirectUri = window.location.origin + "/auth/linkedin-callback";
      setDebugRedirectUri(redirectUri);

      if (oauthError) {
        setError(`LinkedIn avviste forespørselen: ${oauthErrorDesc ?? oauthError}`);
        return;
      }

      if (!code || !state) {
        setError("Mangler code eller state i callback");
        return;
      }

      const savedState = sessionStorage.getItem("linkedin_oauth_state");
      sessionStorage.removeItem("linkedin_oauth_state");
      if (!savedState || savedState !== state) {
        setError("Ugyldig state (mulig CSRF). Prøv på nytt.");
        return;
      }

      setStatus("Veksler kode mot session…");
      const { data, error: invokeErr } = await supabase.functions.invoke("linkedin-login", {
        body: { code, redirect_uri: redirectUri },
      });

      if (cancelled) return;

      if (invokeErr || !data) {
        console.error("linkedin-login invoke error", invokeErr, "redirect_uri:", redirectUri);
        setError(invokeErr?.message ?? "Kunne ikke logge inn med LinkedIn");
        return;
      }

      if (data.error) {
        console.error("linkedin-login error", data, "redirect_uri:", redirectUri);
        setError(data.error);
        return;
      }

      let tokenHash: string | undefined = data.hashed_token;
      if (!tokenHash && typeof data.action_link === "string") {
        try {
          const linkUrl = new URL(data.action_link);
          tokenHash = linkUrl.searchParams.get("token_hash") ?? undefined;
        } catch {
          /* ignore */
        }
      }

      if (!tokenHash || !data.email) {
        setError("Manglet token fra serveren");
        return;
      }

      setStatus("Etablerer session…");
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: tokenHash,
      });

      if (cancelled) return;

      if (verifyErr) {
        console.error("verifyOtp error", verifyErr);
        setError(verifyErr.message);
        return;
      }

      navigate({ to: "/auth/callback", replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-sm shadow-sm">
        <h1 className="text-xl text-foreground">LinkedIn-innlogging</h1>
        {!error ? (
          <p className="mt-3 text-muted-foreground">{status}</p>
        ) : (
          <>
            <p className="mt-3 text-destructive">{error}</p>
            <p className="mt-4 break-all text-xs text-muted-foreground">
              redirect_uri brukt: <code>{debugRedirectUri}</code>
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/login", replace: true })}
              className="mt-6 text-foreground underline"
            >
              Tilbake til innlogging
            </button>
          </>
        )}
      </div>
    </main>
  );
}
