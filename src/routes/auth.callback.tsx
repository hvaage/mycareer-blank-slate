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
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const onboarded = isOnboarded(data.session.user.id);
      navigate({ to: onboarded ? "/app" : "/onboarding", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
