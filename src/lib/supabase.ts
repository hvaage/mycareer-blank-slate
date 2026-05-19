import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const browserStorage = typeof window !== "undefined" ? window.localStorage : undefined;

export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: browserStorage,
    storageKey: "karrierenmin-auth",
    debug: true,
  },
});
