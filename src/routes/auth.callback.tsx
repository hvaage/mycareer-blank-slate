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

      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeErr) {
          console.error("exchangeCodeForSession error", exchangeErr);
          setError(exchangeErr.message);
          return;
        }
      }

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (cancelled) return;

      if (userErr || !userData.user) {
        setError(userErr?.message ?? "Fant ingen aktiv session");
        return;
      }

      const target = await getPostLoginRedirect(userData.user.id);
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
