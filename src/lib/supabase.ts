import { createClient } from "@supabase/supabase-js";

// Use the My Career Builder Supabase project keys.
// VITE_SUPABASE_PUBLISHABLE_KEY is the correct anon/publishable key for
// project miwzhbludgwvskmsfqnq. Do NOT use VITE_SUPABASE_ANON_KEY — that
// variable points at a different Supabase project (ESCO/Markedsinnsikt)
// and causes "Invalid API key" on auth callbacks.
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://miwzhbludgwvskmsfqnq.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const isBrowser = typeof window !== "undefined";

export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: "pkce",
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: false,
    storage: isBrowser ? window.localStorage : undefined,
    storageKey: "karrierenmin-auth",
  },
});
