import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const isBrowser = typeof window !== "undefined";

export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: "pkce",
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: false,
    storage: isBrowser ? window.localStorage : undefined,
    storageKey: "karrierenmin-auth",
    debug: true,
  },
});
