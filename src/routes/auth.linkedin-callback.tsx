import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { getPostLoginRedirect } from "@/lib/post-login-redirect";

export const Route = createFileRoute("/auth/linkedin-callback")({
  component: LinkedInCallback,
});

function LinkedInCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Logger inn med LinkedIn…");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");
      const redirectUri = window.location.origin + "/auth/linkedin-callback";

      if (oauthError) {
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
        return;
      }

      if (!code || !state) {
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
        return;
      }

      const savedState = sessionStorage.getItem("linkedin_oauth_state");
      sessionStorage.removeItem("linkedin_oauth_state");
      if (!savedState || savedState !== state) {
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
        return;
      }

      setStatus("Veksler kode mot session…");
      const { data, error: invokeErr } = await supabase.functions.invoke("linkedin-login", {
        body: { code, redirect_uri: redirectUri },
      });

      if (cancelled) return;

      if (invokeErr || !data || data.error) {
        console.error("linkedin-login error", invokeErr ?? data);
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
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

      if (!tokenHash) {
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
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
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      let userId = sessionData.session?.user.id;
      if (!userId) {
        const { data: userData } = await supabase.auth.getUser();
        userId = userData.user?.id;
      }
      if (cancelled) return;

      if (!userId) {
        setError("Vi klarte ikke å fullføre innloggingen. Prøv igjen.");
        return;
      }

      const target = await getPostLoginRedirect(userId);
      if (cancelled) return;
      navigate({ to: target, replace: true });
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
        {!error ? (
          <p className="mt-3 text-muted-foreground">{status}</p>
        ) : (
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
        )}
      </div>
    </main>
  );
}
