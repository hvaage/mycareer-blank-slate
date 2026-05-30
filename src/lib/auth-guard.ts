import { redirect } from "@tanstack/react-router";
import { authReady } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

/**
 * Guard for protected routes — used in beforeLoad. Waits for hydration,
 * then redirects to /login if no session.
 */
export async function requireAuthenticated(opts: { redirectTo: string }) {
  await authReady;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/login", search: { redirect: opts.redirectTo } });
  }
}

export async function redirectIfAuthenticated(opts?: {
  to?: string;
  search?: { redirect?: string } | Record<string, unknown>;
}) {
  if (typeof window === "undefined") return;
  await authReady;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const search = opts?.search as { redirect?: string } | undefined;
  const candidate = search?.redirect;
  const safeRedirect =
    typeof candidate === "string" && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : null;
  throw redirect({ to: safeRedirect ?? opts?.to ?? "/dashboard" });
}
