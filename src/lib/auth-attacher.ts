import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";

// Project-specific replacement for the generated
// `@/integrations/supabase/auth-attacher`. The generated version imports the
// default client (`@/integrations/supabase/client`), which uses a different
// localStorage key than `@/lib/supabase` (storageKey: "karrierenmin-auth").
// All browser auth flows in this project go through `@/lib/supabase`, so we
// must read the bearer token from that client — otherwise server fns
// protected by `requireSupabaseAuth` reject with
// "Unauthorized: No authorization header provided".
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
