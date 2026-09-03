// Felles autolagring for karriereprofilen.
//
// Både «Min profil» og «Karriereprofil» skriver til samme rad i
// user_career_profiles. Valg lagres umiddelbart, uten egen Lagre-knapp.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export type CareerProfilePatch = Record<string, unknown>;

export function useCareerProfileAutosave(uid: string) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useCallback(
    async (patch: CareerProfilePatch) => {
      if (!uid) return;
      setSaving(true);
      const { error } = await supabase
        .from("user_career_profiles")
        .upsert({ user_id: uid, ...patch } as never, { onConflict: "user_id" });
      setSaving(false);
      if (error) {
        toast.error(error.message ?? "Kunne ikke lagre");
        return;
      }
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["user-career-profile", uid] });
      qc.invalidateQueries({ queryKey: ["profile-dashboard", uid] });
    },
    [qc, uid],
  );

  return { save, saving, savedAt };
}
