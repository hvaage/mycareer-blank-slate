// @ts-nocheck
/**
 * OAuth redirect URIs must match exactly what is registered at Google / LinkedIn
 * and what the server uses during code exchange.
 *
 * - Vite: set `VITE_LINKEDIN_REDIRECT_URI` (e.g. https://app.example.com/auth/linkedin-callback)
 * - Supabase Edge: set `LINKEDIN_REDIRECT_URI` to the same string.
 */
export function getLinkedInRedirectUri(): string {
  const fromEnv = import.meta.env.VITE_LINKEDIN_REDIRECT_URI as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, "")}/auth/linkedin-callback`;
  }
  return "";
}
