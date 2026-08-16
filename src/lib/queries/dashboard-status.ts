/**
 * Datagrunnlaget for dashboardet.
 *
 * Dashboardet svarer på ett spørsmål: hva bør jeg gjøre nå? Derfor henter
 * denne modulen bare to slags tall — mangler (blokkeringer) og køer. Alt som
 * ikke kan handles på, hentes ikke.
 *
 * Ingen tall uten grunnlag: er `foundation.total` null, skal ingen
 * grunnlagsavhengige tall vises.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type FoundationStatus = {
  roles: number;
  results: number;
  competences: number;
  /** Kompetanse/eksponering uten belegg — kan rettes ved å koble til en rolle. */
  unbacked: number;
  /** Bekreftet av andre (leder eller tredjepart). */
  attested: number;
  total: number;
};

export type ReviewQueue = {
  /** Ubehandlede linjer fra CV-import. */
  candidates: number;
  /** Ønsker og verdier som har passert ferskhetsgrensen. */
  stale: number;
  /** Mål med passert frist som ikke er lukket. */
  overdueGoals: number;
  /** AI-forslag som venter på svar. */
  proposals: number;
  total: number;
};

export const foundationStatusQuery = (userId: string) =>
  queryOptions({
    queryKey: ["dashboard-foundation", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<FoundationStatus> => {
      const { data, error } = await supabase
        .from("career_atoms")
        .select("atom_type, atom_class, attestation, evidence_atom_ids, parent_atom_id")
        .eq("user_id", userId)
        .eq("atom_kind", "evidens")
        .eq("is_active", true);
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;

      let roles = 0;
      let results = 0;
      let competences = 0;
      let unbacked = 0;
      let attested = 0;

      for (const r of rows) {
        const cls = String(r["atom_class"] ?? "");
        if (r["atom_type"] === "role") roles += 1;
        if (cls === "resultat") results += 1;
        if (cls === "kompetanse" || cls === "eksponering") {
          competences += 1;
          const links = (r["evidence_atom_ids"] as string[] | null) ?? [];
          if (links.length === 0 && !r["parent_atom_id"]) unbacked += 1;
        }
        const att = String(r["attestation"] ?? "");
        if (att === "bekreftet_av_leder" || att === "bekreftet_tredjepart") attested += 1;
      }

      return { roles, results, competences, unbacked, attested, total: rows.length };
    },
  });

export const reviewQueueQuery = (userId: string) =>
  queryOptions({
    queryKey: ["dashboard-review-queue", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<ReviewQueue> => {
      const nowIso = new Date().toISOString();
      const [cand, stale, goals, proposals] = await Promise.all([
        supabase
          .from("cv_parse_candidates")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "ubehandlet"),
        supabase
          .from("career_atoms")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true)
          .in("atom_kind", ["onske", "verdi"])
          .not("stale_at", "is", null)
          .lt("stale_at", nowIso),
        supabase
          .from("career_atoms")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true)
          .eq("atom_kind", "maal")
          .in("state", ["planlagt", "i_arbeid"])
          .not("due_at", "is", null)
          .lt("due_at", nowIso),
        supabase
          .from("atom_enrichment_proposals")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "pending_review"),
      ]);

      const n = (r: { count: number | null }) => r.count ?? 0;
      const out = {
        candidates: n(cand),
        stale: n(stale),
        overdueGoals: n(goals),
        proposals: n(proposals),
      };
      return { ...out, total: out.candidates + out.stale + out.overdueGoals + out.proposals };
    },
  });

/** Nye muligheter som ikke er avvist og ikke luket bort av screeningen. */
export const newOpportunitiesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["dashboard-new-opportunities", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("user_opportunities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "new")
        .or("screening_status.is.null,screening_status.neq.excluded");
      if (error) throw error;
      return count ?? 0;
    },
  });
