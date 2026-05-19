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
      // PKCE flow: exchange ?code=... for a session
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("code")) {
          await supabase.auth.exchangeCodeForSession(window.location.href);
        }
      } catch {
        // ignore — fall through to getSession polling (implicit flow uses #hash)
      }

      // Poll for session — gives Supabase time to parse URL hash (#access_token)
      // and persist the session to storage.
      for (let i = 0; i < 15; i++) {
        if (cancelled) return;
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          // Fallback: ensure user is hydrated from hash if session was missed
          if (!data.session.user) {
            await supabase.auth.getUser();
          }
          await new Promise((r) => setTimeout(r, 300));
          if (!cancelled) navigate({ to: "/onboarding", replace: true });
          return;
        }

        // Try getUser() — forces parsing of URL hash tokens
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          await new Promise((r) => setTimeout(r, 300));
          if (!cancelled) navigate({ to: "/onboarding", replace: true });
          return;
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      if (!cancelled) navigate({ to: "/login", replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
