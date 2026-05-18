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
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/login" });
        return;
      }
      const onboarded = await isOnboarded(data.session.user.id);
      navigate({ to: onboarded ? "/app" : "/onboarding" });
    })();
  }, [navigate]);

  return null;
}
