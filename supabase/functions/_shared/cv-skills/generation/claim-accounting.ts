// Deterministisk regnskap for dokument-claims.
//
// Hver claim i dokumentet skal ha en eksplisitt verifikasjonsstatus, og
// kontrollen skjer alltid mot claimens EGNE supporting atoms — ikke mot hele
// snapshotet. Et tall som finnes et annet sted i grunnlaget belegger ikke
// denne claimen.
//
// Rene funksjoner: ingen database, ingen nettverk, ingen modellkall.

import type { GeneratedClaim, SnapshotAtom } from "./contract.ts";
import type { AtomLike, ClaimMatch } from "../vendor/cv-hallucination-guard/scripts/types.ts";
import { extractAllClaims } from "../vendor/cv-hallucination-guard/scripts/extractors/claim-extractor.ts";
import { matchHardClaims } from "../vendor/cv-hallucination-guard/scripts/matchers/exact-matcher.ts";
import { matchSoftClaimsLight } from "../vendor/cv-hallucination-guard/scripts/matchers/semantic-matcher.ts";

export type ClaimVerification = GeneratedClaim["verification"];

export type ClaimAccountingEntry = {
  claimId: string;
  blockId: string;
  type: "hard" | "soft";
  verification: ClaimVerification;
  reason: string;
  scopedAtomIds: string[];
  matchedAtomIds: string[];
};

export type ClaimAccounting = {
  entries: ClaimAccountingEntry[];
  summary: {
    total: number;
    hard: number;
    soft: number;
    supported: number;
    partially_supported: number;
    unsupported: number;
    not_applicable: number;
  };
};

export function snapshotAtomToAtomLike(atom: SnapshotAtom): AtomLike {
  return {
    id: atom.id,
    atom_type: atom.atom_type ?? atom.atom_kind ?? "unknown",
    parent_atom_id: atom.parent_atom_id,
    content_no: atom.content_no,
    content_en: atom.content_en,
    structured_data: (atom.structured_data ?? null) as Record<string, unknown> | null,
    source_quote: atom.source_quote,
    confidence: (atom.confidence ?? undefined) as AtomLike["confidence"],
  };
}

/** Strukturelle elementer er ikke faktapåstander og skal ikke telles som claims. */
export function isStructuralValue(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  // Rene seksjonsoverskrifter uten faktainnhold.
  return /^(erfaring|utdanning|ferdigheter|språk|sertifiseringer|profilsammendrag|summary|experience|education|skills|languages|certifications)$/i
    .test(v);
}

function worstVerdict(matches: ClaimMatch[]): ClaimVerification {
  if (matches.length === 0) return "not_applicable";
  if (matches.some((m) => m.verdict === "contradicted" || m.verdict === "unverified")) {
    return "unsupported";
  }
  if (matches.some((m) => m.verdict === "partial")) return "partially_supported";
  return "supported";
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function atomHaystack(atom: AtomLike): string {
  return normalize(
    [atom.content_no, atom.content_en, atom.source_quote, JSON.stringify(atom.structured_data ?? {})]
      .filter(Boolean)
      .join(" "),
  );
}

/** Tekstlig dekning: hvor stor andel av claimens ord finnes i atom-teksten. */
function coverage(value: string, atoms: AtomLike[]): { ratio: number; atomId: string | null } {
  const tokens = normalize(value).split(" ").filter((t) => t.length > 2);
  if (tokens.length === 0) return { ratio: 0, atomId: null };
  let best = 0;
  let bestId: string | null = null;
  for (const atom of atoms) {
    const hay = atomHaystack(atom);
    const hit = tokens.filter((t) => hay.includes(t)).length / tokens.length;
    if (hit > best) {
      best = hit;
      bestId = atom.id;
    }
  }
  return { ratio: best, atomId: bestId };
}

export function accountClaims(
  claims: GeneratedClaim[],
  snapshotAtoms: SnapshotAtom[],
): ClaimAccounting {
  const byId = new Map(snapshotAtoms.map((a) => [a.id, snapshotAtomToAtomLike(a)]));
  const entries: ClaimAccountingEntry[] = [];

  for (const claim of claims) {
    if (isStructuralValue(claim.value)) {
      entries.push({
        claimId: claim.claimId,
        blockId: claim.blockId,
        type: claim.type,
        verification: "not_applicable",
        reason: "structural_element",
        scopedAtomIds: [],
        matchedAtomIds: [],
      });
      continue;
    }

    const scoped = claim.supportingAtomIds
      .map((id) => byId.get(id))
      .filter((a): a is AtomLike => a != null);

    if (scoped.length === 0) {
      entries.push({
        claimId: claim.claimId,
        blockId: claim.blockId,
        type: claim.type,
        verification: "unsupported",
        reason: "no_supporting_atoms_in_snapshot",
        scopedAtomIds: claim.supportingAtomIds,
        matchedAtomIds: [],
      });
      continue;
    }

    const extracted = extractAllClaims(claim.value, scoped);
    const hardMatches = matchHardClaims(extracted, scoped);
    const softMatches = matchSoftClaimsLight(extracted, scoped);

    let verification: ClaimVerification;
    let reason: string;
    let matched: string[] = [];

    if (hardMatches.length > 0) {
      verification = worstVerdict(hardMatches);
      reason = `hard_match:${hardMatches.length}`;
      matched = hardMatches.flatMap((m) => m.supporting_atom_ids);
    } else if (softMatches.length > 0 && worstVerdict(softMatches) !== "unsupported") {
      verification = worstVerdict(softMatches);
      reason = `soft_match:${softMatches.length}`;
      matched = softMatches.flatMap((m) => m.supporting_atom_ids);
    } else {
      const cov = coverage(claim.value, scoped);
      if (cov.ratio >= 0.7) {
        verification = "supported";
        reason = `text_coverage:${cov.ratio.toFixed(2)}`;
        matched = cov.atomId ? [cov.atomId] : [];
      } else if (cov.ratio >= 0.4) {
        verification = "partially_supported";
        reason = `text_coverage:${cov.ratio.toFixed(2)}`;
        matched = cov.atomId ? [cov.atomId] : [];
      } else {
        verification = "unsupported";
        reason = `text_coverage:${cov.ratio.toFixed(2)}`;
      }
    }

    entries.push({
      claimId: claim.claimId,
      blockId: claim.blockId,
      type: claim.type,
      verification,
      reason,
      scopedAtomIds: scoped.map((a) => a.id),
      matchedAtomIds: [...new Set(matched)],
    });
  }

  const summary = {
    total: entries.length,
    hard: entries.filter((e) => e.type === "hard").length,
    soft: entries.filter((e) => e.type === "soft").length,
    supported: entries.filter((e) => e.verification === "supported").length,
    partially_supported: entries.filter((e) => e.verification === "partially_supported").length,
    unsupported: entries.filter((e) => e.verification === "unsupported").length,
    not_applicable: entries.filter((e) => e.verification === "not_applicable").length,
  };

  return { entries, summary };
}
