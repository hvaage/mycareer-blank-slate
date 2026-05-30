import { redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

/**
 * Server-side admin role check. Tries public.has_role(uid, 'admin') first,
 * falls back to a direct SELECT on user_roles. Throws redirect to /dashboard
 * if user is not an admin (or not logged in).
 */
export async function requireAdmin(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw redirect({ to: "/login" });
  }

  // Try RPC first
  try {
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!error) {
      if (data === true) return;
      throw redirect({ to: "/dashboard" });
    }
  } catch (e: any) {
    // re-throw router redirects
    if (e && typeof e === "object" && "to" in e) throw e;
  }

  // Fallback: direct query
  const { data: rows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  if (rows && rows.length > 0) return;

  throw redirect({ to: "/dashboard" });
}

/** Hook-friendly client check (returns boolean, does not redirect). */
export async function isAdmin(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!error) return data === true;
  } catch {
    /* ignore */
  }
  const { data: rows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  return !!rows && rows.length > 0;
}
