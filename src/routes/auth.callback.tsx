import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { isOnboarded } from "@/lib/onboarding";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const waitForSession = async () => {
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) return data.session;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };
    (async () => {
      const session = await waitForSession();
      if (cancelled) return;
      if (!session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const onboarded = isOnboarded(session.user.id);
      navigate({ to: onboarded ? "/app" : "/onboarding", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
