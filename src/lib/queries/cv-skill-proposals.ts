/**
 * Leser v2.1-forslagene for en import. Kun lesing — trinn 3 bruker disse som
 * autoritet for kompetanseplassering, men skriver aldri til dem herfra.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SkillProposalRow } from "@/lib/cv-review-skill-basis";

export async function fetchImportProposals(importId: string): Promise<SkillProposalRow[]> {
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .select("id, proposal_payload")
    .eq("source_import_id", importId)
    .limit(1000);
  if (error) throw error;
  return ((data ?? []) as { id: string; proposal_payload: unknown }[]).map((r) => ({
    id: r.id,
    payload: (r.proposal_payload ?? {}) as SkillProposalRow["payload"],
  }));
}

export function importProposalsQuery(importId: string | null) {
  return queryOptions({
    queryKey: ["cv-import-proposals", importId],
    queryFn: () => fetchImportProposals(importId!),
    enabled: Boolean(importId),
    staleTime: 30_000,
  });
}
