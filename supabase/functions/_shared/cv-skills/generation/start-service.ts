// Server-side tjenestegrense for oppstart av CV-generering.
//
// Formål: serverruten (src/routes/api/cv/generations.ts) skal aldri importere
// vendor-runtime, adapter eller modellklient. Ruten eier HTTP, autentisering
// og eierskapskontroll; denne porten eier vurdering av grunnlaget og frysing
// av snapshot. Ingen modellkall, ingen databaseskriving skjer her.

import { assessReadiness, eligibleAtoms } from "../adapters/career-atom-adapter.ts";
import type { CareerAtomRow } from "../adapters/career-atom-adapter.ts";
import type { ReadinessReport } from "../contract.ts";
import { buildSnapshot, sha256Hex, snapshotHashInput } from "./contract.ts";
import type { GenerationSnapshot } from "./contract.ts";

export type GenerationStartInput = {
  rows: CareerAtomRow[];
  openProposals?: number;
  conflicts?: number;
  frozenAt?: string;
};

export type GenerationStartPreparation = {
  readiness: ReadinessReport;
  /** Tom når readiness blokkerer; ruten skal da ikke opprette jobb. */
  eligibleAtomIds: string[];
  snapshot: GenerationSnapshot | null;
  snapshotHash: string | null;
  frozenAt: string;
};

/**
 * Vurderer grunnlaget og fryser snapshot for en generell CV.
 *
 * Blokkerende readiness (`blocked_no_evidence`, `needs_review`) gir ingen
 * snapshot — kallet er da rent lesende og uten sideeffekter.
 */
export async function prepareGenerationStart(
  input: GenerationStartInput,
): Promise<GenerationStartPreparation> {
  const rows = input.rows ?? [];
  const readiness = assessReadiness({
    rows,
    openProposals: input.openProposals ?? 0,
    conflicts: input.conflicts ?? 0,
  });

  const frozenAt = input.frozenAt ?? new Date().toISOString();

  if (readiness.status === "blocked_no_evidence" || readiness.status === "needs_review") {
    return { readiness, eligibleAtomIds: [], snapshot: null, snapshotHash: null, frozenAt };
  }

  const eligible = eligibleAtoms(rows);
  const snapshot = buildSnapshot(eligible, {}, frozenAt);
  const snapshotHash = await sha256Hex(snapshotHashInput(snapshot));

  return {
    readiness,
    eligibleAtomIds: eligible.map((a) => a.id),
    snapshot,
    snapshotHash,
    frozenAt,
  };
}
