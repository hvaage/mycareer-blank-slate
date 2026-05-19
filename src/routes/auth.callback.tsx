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
      // STEP 1: Manually parse tokens from URL hash and set session
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash.substring(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
      } else {
        // PKCE flow fallback
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get("code")) {
            await supabase.auth.exchangeCodeForSession(window.location.href);
          }
        } catch {
          // ignore
        }
      }

      // STEP 2: Verify session exists
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        navigate({ to: "/login", replace: true });
        return;
      }

      // STEP 3: Clean URL (remove hash)
      window.history.replaceState({}, document.title, "/auth/callback");

      // STEP 4: Navigate
      navigate({ to: "/onboarding", replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
