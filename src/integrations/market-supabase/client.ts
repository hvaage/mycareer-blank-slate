// ============================================================
// Market Supabase client — ESCO project (wcaqfupjatnjwbgatzjv)
// ============================================================
//
// This is a SEPARATE Supabase client from the My Career Builder
// project's `@/integrations/supabase/client`. It is used only for the
// public Markedsinnsikt page (/markedsinnsikt) to call public RPCs
// against the ESCO data project.
//
// Configuration order:
//   1. import.meta.env.VITE_MARKET_SUPABASE_URL / _ANON_KEY (preferred)
//   2. Hard-coded publishable defaults for the ESCO project (safe — these
//      are publishable keys, not secrets).
//
// Never use this client for authenticated user data — it talks to a
// different project and is anonymous-only.

import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://wcaqfupjatnjwbgatzjv.supabase.co";
const FALLBACK_KEY = "sb_publishable_6oF5IlcV8nzFvOf8QvYr2w_XmNeXEc";

const envUrl =
  (import.meta.env.VITE_MARKET_SUPABASE_URL as string | undefined) ?? "";
const envKey =
  (import.meta.env.VITE_MARKET_SUPABASE_ANON_KEY as string | undefined) ?? "";

const url = envUrl && envUrl.length > 0 ? envUrl : FALLBACK_URL;
const key = envKey && envKey.length > 0 ? envKey : FALLBACK_KEY;

if (import.meta.env.DEV) {
  if (!envUrl) {
    // eslint-disable-next-line no-console
    console.info(
      "[market-supabase] VITE_MARKET_SUPABASE_URL not set — using publishable fallback for ESCO project.",
    );
  }
  if (!envKey) {
    // eslint-disable-next-line no-console
    console.info(
      "[market-supabase] VITE_MARKET_SUPABASE_ANON_KEY not set — using publishable fallback for ESCO project.",
    );
  }
}

export const marketSupabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
