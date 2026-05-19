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
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        window.location.href,
      );
      if (cancelled) return;

      if (error || !data.session) {
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
