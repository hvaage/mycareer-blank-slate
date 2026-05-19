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
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.auth.getSession();

        if (data.session) {
          setTimeout(() => {
            if (!cancelled) navigate({ to: "/onboarding", replace: true });
          }, 100);
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
