// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
  given_name: string | null;
  display_name: string | null;
  linkedin_picture_url: string | null;
  linkedin_headline: string | null;
  linkedin_vanity_url: string | null;
  linkedin_email_verified: boolean | null;
  linkedin_locale: string | null;
};

/** Cached, app-wide current-user profile (used for avatar + greetings). */
export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me-profile", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProfileLite | null> => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, given_name, display_name, linkedin_picture_url, linkedin_headline, linkedin_vanity_url, linkedin_email_verified, linkedin_locale",
        )
        .eq("id", user!.id)
        .maybeSingle();
      return (data as ProfileLite) ?? null;
    },
  });
}

export function firstName(p: ProfileLite | null | undefined): string {
  if (!p) return "";
  if (p.given_name) return p.given_name;
  const full = p.full_name ?? p.display_name ?? "";
  return full.trim().split(/\s+/)[0] ?? "";
}

export function initials(p: ProfileLite | null | undefined): string {
  if (!p) return "?";
  const full = p.full_name ?? p.display_name ?? p.email ?? "";
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
