// @ts-nocheck
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** Bruker-id fra gjeldende sesjon. Alle lesinger er bruker-scopet via RLS. */
export function useAuthUserId(): string | undefined {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id);
    });
    return () => {
      active = false;
    };
  }, []);
  return userId;
}
