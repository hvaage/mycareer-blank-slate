// ============================================================
// Market Supabase client — ESCO project (wcaqfupjatnjwbgatzjv)
// ============================================================
//
// Reads URL + anon key in this order:
//   1. window.__MARKET_SUPABASE_URL / __MARKET_SUPABASE_KEY — injected by
//      __root.tsx <script> from process.env.MARKET_SUPABASE_URL /
//      MARKET_SUPABASE_ANON_KEY at SSR time. This is the production path.
//   2. import.meta.env.VITE_MARKET_SUPABASE_URL / _ANON_KEY (legacy).
//   3. Hard-coded URL + anon key fallback.
//
// The anon key is a publishable JWT and safe to expose to the browser.

import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://wcaqfupjatnjwbgatzjv.supabase.co";
const FALLBACK_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjYXFmdXBqYXRuandiZ2F0emp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzY3OTcsImV4cCI6MjA5NTMxMjc5N30.6A869EjBHgXhEBAIkO6r3ojuYiHSpabUjXnsMHJPEoU";

type Win = {
  __MARKET_SUPABASE_URL?: string;
  __MARKET_SUPABASE_KEY?: string;
};

const w: Win = typeof window !== "undefined" ? (window as unknown as Win) : {};

const envUrl =
  (import.meta.env.VITE_MARKET_SUPABASE_URL as string | undefined) ?? "";
const envKey =
  (import.meta.env.VITE_MARKET_SUPABASE_ANON_KEY as string | undefined) ?? "";

function getValidAnonKey(candidate: string | undefined) {
  const key = candidate?.trim() ?? "";
  return key.includes(".eyJpc3MiOiJzdXBh") ? key : FALLBACK_KEY;
}

const url =
  (w.__MARKET_SUPABASE_URL && w.__MARKET_SUPABASE_URL.length > 0
    ? w.__MARKET_SUPABASE_URL
    : envUrl) || FALLBACK_URL;

const key =
  getValidAnonKey(w.__MARKET_SUPABASE_KEY && w.__MARKET_SUPABASE_KEY.length > 0
    ? w.__MARKET_SUPABASE_KEY
    : envKey);

if (import.meta.env.DEV && !key) {
  // eslint-disable-next-line no-console
  console.error(
    "[market-supabase] Missing anon key. Set MARKET_SUPABASE_ANON_KEY (server secret) — it is injected into window at SSR by __root.tsx.",
  );
}

export const marketSupabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
