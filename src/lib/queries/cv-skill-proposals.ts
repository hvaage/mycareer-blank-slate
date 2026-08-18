/**
 * Leser v2.1-forslagene for en import. Kun lesing — trinn 3 bruker disse som
 * autoritet for kompetanseplassering, men skriver aldri til dem herfra.
 *
 * «Nyeste analysekjøring» betyr nyeste *komplette* kjøring: en kjøring som
 * faktisk inneholder rolle- og resultatforslag. En avbrutt eller delvis
 * kjøring (typisk en ren kompetansekjøring) kan ikke overstyre siste komplette
 * review-grunnlag — den legges bare oppå som oppdatert kompetansebelegg når
 * den bygger på samme frosne input.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SkillProposalRow } from "@/lib/cv-review-skill-basis";

type BatchRow = { id: string; created_at: string; input_signature: string | null };
type ProposalRow = { id: string; batch_id: string; proposal_payload: unknown };

const SKILL_TYPES = new Set(["skill", "domain"]);

function baseSignature(signature: string | null): string {
  return (signature ?? "").split("+")[0] ?? "";
}

export async function fetchImportProposals(importId: string): Promise<SkillProposalRow[]> {
  const { data: batchData, error: batchError } = await supabase
    .from("atom_enrichment_batches")
    .select("id, created_at, input_signature")
    .eq("source_id", importId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (batchError) throw batchError;
  const batches = (batchData ?? []) as BatchRow[];
  if (batches.length === 0) return [];

  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .select("id, batch_id, proposal_payload")
    .in(
      "batch_id",
      batches.map((b) => b.id),
    )
    .limit(4000);
  if (error) throw error;

  const rows = ((data ?? []) as ProposalRow[]).map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    payload: (r.proposal_payload ?? {}) as SkillProposalRow["payload"],
  }));
  const byBatch = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byBatch.get(row.batchId) ?? [];
    list.push(row);
    byBatch.set(row.batchId, list);
  }

  // Komplett kjøring = inneholder minst ett rolleforslag. Uten roller finnes
  // ingen struktur å belegge kompetanse mot.
  const baseIndex = batches.findIndex((b) =>
    (byBatch.get(b.id) ?? []).some((r) => r.payload.atom_type === "role"),
  );
  if (baseIndex < 0) return [];
  const base = batches[baseIndex]!;
  const baseRows = byBatch.get(base.id) ?? [];
  const baseSig = baseSignature(base.input_signature);

  // Nyere, kompatible kjøringer kan oppdatere kompetansebelegget. De erstatter
  // kompetanser per canonical key, men rører ikke roller og resultater.
  const overlays = batches
    .slice(0, baseIndex)
    .filter((b) => baseSignature(b.input_signature) === baseSig)
    .reverse();

  const skillByKey = new Map<string, SkillProposalRow>();
  const keyOf = (p: SkillProposalRow): string => {
    const sd = (p.payload.structured_data ?? {}) as Record<string, unknown>;
    const key = typeof sd["canonical_key"] === "string" ? sd["canonical_key"] : "";
    return key || p.id;
  };

  const structural: SkillProposalRow[] = [];
  for (const row of baseRows) {
    const item: SkillProposalRow = { id: row.id, payload: row.payload };
    if (SKILL_TYPES.has(row.payload.atom_type ?? "")) skillByKey.set(keyOf(item), item);
    else structural.push(item);
  }
  for (const batch of overlays) {
    for (const row of byBatch.get(batch.id) ?? []) {
      if (!SKILL_TYPES.has(row.payload.atom_type ?? "")) continue;
      const item: SkillProposalRow = { id: row.id, payload: row.payload };
      skillByKey.set(keyOf(item), item);
    }
  }

  return [...structural, ...skillByKey.values()];
}

export function importProposalsQuery(importId: string | null) {
  return queryOptions({
    queryKey: ["cv-import-proposals", importId],
    queryFn: () => fetchImportProposals(importId!),
    enabled: Boolean(importId),
    staleTime: 30_000,
  });
}
