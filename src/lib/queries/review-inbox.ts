// @ts-nocheck
// ============================================================
// Kildeuavhengig teller for «Gjennomgå forslag».
// Nye kildetyper legges til i SOURCE_QUEUES — ingen andre steder.
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ReviewInboxCounts = {
  cv: number;
  ai: number;
  employer: number;
  linkedin: number;
  credentials: number;
  total: number;
};

type QueueKey = keyof Omit<ReviewInboxCounts, "total">;

const SOURCE_QUEUES: Array<{
  key: QueueKey;
  count: (userId: string) => Promise<number>;
}> = [
  {
    key: "cv",
    count: async (userId) => {
      const [candidates, imports] = await Promise.all([
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
      ]);
      if (candidates.error) throw candidates.error;
      if (imports.error) throw imports.error;
      return (candidates.count ?? 0) + (imports.count ?? 0);
    },
  },
  {
    key: "ai",
    count: async (userId) => {
      const { count, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ["pending_review", "approved_for_promotion", "promotion_failed"]);
      if (error) throw error;
      return count ?? 0;
    },
  },
  // Kommende kilder: arbeidsgiverdokumenter, LinkedIn, kursbevis.
  { key: "employer", count: async () => 0 },
  {
    key: "linkedin",
    count: async (userId) => {
      const { count, error } = await supabase
        .from("linkedin_reconciliation_proposals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "pending_review");
      if (error) throw error;
      return count ?? 0;
    },
  },
  { key: "credentials", count: async () => 0 },
];

export function useReviewInboxCounts(userId: string | undefined) {
  return useQuery({
    queryKey: ["review-inbox-counts", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ReviewInboxCounts> => {
      const results = await Promise.all(SOURCE_QUEUES.map((q) => q.count(userId!)));
      const counts = SOURCE_QUEUES.reduce<Record<string, number>>((acc, q, i) => {
        acc[q.key] = results[i] ?? 0;
        return acc;
      }, {});
      const total = results.reduce((a, b) => a + (b ?? 0), 0);
      return { cv: 0, ai: 0, employer: 0, linkedin: 0, credentials: 0, ...counts, total };
    },
  });
}
