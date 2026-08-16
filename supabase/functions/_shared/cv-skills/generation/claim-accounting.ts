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

/**
 * Grunnlaget er ofte engelsk mens teksten er norsk. Ekvivalensene under er
 * rene oversettelser — de utvider aldri betydningen av en påstand.
 */
const NO_EN_EQUIVALENTS: Readonly<Record<string, string[]>> = {
  norsk: ["norwegian"],
  engelsk: ["english"],
  morsmålsnivå: ["native"],
  morsmål: ["native"],
  flytende: ["fluent"],
  ledet: ["led", "leadership", "leading"],
  ledelse: ["leadership"],
  teamledelse: ["team leadership", "team leads"],
  drift: ["operations", "operating"],
  teknisk: ["technical"],
  arkitektur: ["architecture"],
  virksomheten: ["business"],
  virksomhet: ["business"],
  oppstart: ["start up", "startup", "start-up"],
  markedsledende: ["market leading", "market-leading"],
  norske: ["norwegian", "norway"],
  omsetning: ["revenue"],
  personer: ["people"],
  nivå: ["level"],
};

const MONTHS_NO: Readonly<Record<string, string>> = {
  januar: "01", februar: "02", mars: "03", april: "04", mai: "05", juni: "06",
  juli: "07", august: "08", september: "09", oktober: "10", november: "11", desember: "12",
};

/** "april 2007 til desember 2014" -> ["2007-04", "2014-12"] */
export function extractNorwegianPeriods(value: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b(${Object.keys(MONTHS_NO).join("|")})\\s+(\\d{4})\\b`, "gi");
  for (const m of value.matchAll(re)) {
    const month = MONTHS_NO[m[1].toLowerCase()];
    if (month) out.push(`${m[2]}-${month}`);
  }
  return out;
}

function atomDates(atom: AtomLike): string[] {
  const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
  return ["start_date", "end_date"]
    .map((k) => sd[k])
    .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}/.test(v))
    .map((v) => v.slice(0, 7));
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
    const hit = tokens.filter((t) => {
      if (hay.includes(t)) return true;
      const alts = NO_EN_EQUIVALENTS[t];
      return alts != null && alts.some((a) => hay.includes(normalize(a)));
    }).length / tokens.length;
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

    const periods = extractNorwegianPeriods(claim.value);
    const periodAtom = periods.length > 0
      ? scoped.find((a) => {
        const dates = atomDates(a);
        return periods.every((p) => dates.includes(p));
      })
      : undefined;

    if (periods.length > 0 && periodAtom) {
      verification = "supported";
      reason = `period_match:${periods.join(",")}`;
      matched = [periodAtom.id];
    } else if (periods.length > 0 && scoped.some((a) => atomDates(a).length > 0)) {
      verification = "unsupported";
      reason = `period_mismatch:${periods.join(",")}`;
    } else if (hardMatches.length > 0) {
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
