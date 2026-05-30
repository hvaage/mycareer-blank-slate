import { supabase } from "@/lib/supabase";

/**
 * Returns the route a freshly-authenticated user should land on.
 * - "/onboarding" if profile is missing or onboarding_completed !== true
 * - "/app" otherwise
 */
export async function getPostLoginRedirect(userId: string): Promise<"/app" | "/onboarding"> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", userId)
      .maybeSingle();
    return data?.onboarding_completed === true ? "/app" : "/onboarding";
  } catch {
    return "/onboarding";
  }
}
