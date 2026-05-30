// @ts-nocheck
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/integrations/supabase/types";

export type UserCareerProfileRow = Tables<"user_career_profiles">;

export const userCareerProfileQuery = (userId: string) =>
  queryOptions({
    queryKey: ["user-career-profile", userId],
    staleTime: 60_000,
    queryFn: async (): Promise<UserCareerProfileRow | null> => {
      const { data, error } = await supabase
        .from("user_career_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as UserCareerProfileRow | null;
    },
  });
