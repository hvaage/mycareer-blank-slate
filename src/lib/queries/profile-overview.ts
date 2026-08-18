// @ts-nocheck
/**
 * Statusgrunnlaget for «Min profil».
 *
 * Reglene er datadrevne og bevisst strenge:
 *  - bare bekreftede `career_atoms` teller som roller, resultater og kompetanser
 *  - ubehandlede parsekandidater eller en åpen CV-import gir «Trenger gjennomgang»
 *  - et område er «Fullført» først når det faktisk har innhold, ikke når feltet finnes
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { documentationAtomBasisQuery } from "@/lib/queries/documentation-atoms";

export type AreaStatus = "fullfort" | "delvis" | "mangler" | "gjennomgang";

export const AREA_STATUS_LABEL: Record<AreaStatus, string> = {
  fullfort: "Fullført",
  delvis: "Delvis utfylt",
  mangler: "Mangler",
  gjennomgang: "Trenger gjennomgang",
};

export function filledOf(...vals: unknown[]) {
  return vals.filter((v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return Number.isFinite(v);
    return v === true;
  }).length;
}

export function statusFromCount(filled: number, total: number): AreaStatus {
  if (filled <= 0) return "mangler";
  if (filled >= total) return "fullfort";
  return "delvis";
}

export function useProfileOverviewData(userId: string) {
  const atoms = useQuery(documentationAtomBasisQuery(userId));

  const profile = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const stage = useQuery({
    queryKey: ["user-career-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_career_profiles")
        .select("career_stage")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const pending = useQuery({
    queryKey: ["profile-overview-pending", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [candidates, imports, documents] = await Promise.all([
        supabase
          .from("cv_parse_candidates")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "ubehandlet"),
        supabase
          .from("cv_imports")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("committed_at", null)
          .in("status", ["pending", "processing", "parsed"]),
        supabase.from("documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
      ]);
      if (candidates.error) throw candidates.error;
      if (imports.error) throw imports.error;
      if (documents.error) throw documents.error;
      return {
        pendingCandidates: candidates.count ?? 0,
        openImports: imports.count ?? 0,
        documents: documents.count ?? 0,
      };
    },
  });

  return {
    isLoading: atoms.isLoading || profile.isLoading || pending.isLoading,
    atoms: atoms.data ?? null,
    profile: profile.data ?? null,
    careerStage: (stage.data?.career_stage as string | null) ?? null,
    pending: pending.data ?? { pendingCandidates: 0, openImports: 0, documents: 0 },
  };
}
