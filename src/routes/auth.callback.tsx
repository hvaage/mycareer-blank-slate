import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (cancelled) return;

        if (error) {
          navigate({ to: "/login", replace: true });
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        await supabase.auth.refreshSession();
        if (cancelled) return;

        const { data: retry } = await supabase.auth.getSession();
        console.log("SESSION AFTER LOGIN", await supabase.auth.getSession());

        if (cancelled) return;
        if (!retry.session) {
          navigate({ to: "/login", replace: true });
          return;
        }
      } else {
        console.log("SESSION AFTER LOGIN", await supabase.auth.getSession());
      }

      if (cancelled) return;

      if (window.location.search) {
        window.history.replaceState({}, document.title, "/auth/callback");
      }

      try {
        localStorage.setItem("karrierenmin-auth-sync", String(Date.now()));
      } catch {
        // Ignore storage write errors; Supabase owns the actual session storage.
      }

      if (cancelled) return;

      const { data: verified } = await supabase.auth.getSession();
      if (!verified.session) {
        navigate({ to: "/login", replace: true });
        return;
      }

      navigate({ to: "/onboarding", replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
