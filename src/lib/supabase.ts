import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Single source of truth for the Supabase client (project miwzhbludgwvskmsfqnq).
// All browser-side code — auth-context, callbacks, queries, components, routes —
// MUST import `supabase` from here so we share one auth session (storageKey:
// "karrierenmin-auth"). Do NOT import from "@/integrations/supabase/client"
// in browser code; that client uses a different storage key and produces a
// second, unauthenticated session that silently breaks RLS queries.
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://miwzhbludgwvskmsfqnq.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const isBrowser = typeof window !== "undefined";

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    flowType: "pkce",
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: false,
    storage: isBrowser ? window.localStorage : undefined,
    storageKey: "karrierenmin-auth",
  },
});
