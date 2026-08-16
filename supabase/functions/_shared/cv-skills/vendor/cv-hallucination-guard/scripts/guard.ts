// cv-hallucination-guard — Hovedmotor
// Eneste fil Edge-funksjoner og frontend trenger å importere for å bruke
// Skill-en.

import type {
  AtomLike,
  ClaimMatch,
  GuardMode,
  GuardResult,
  LlmJudgeClient,
} from "./types.ts";
import { extractAllClaims } from "./extractors/claim-extractor.ts";
import { matchHardClaims } from "./matchers/exact-matcher.ts";
import { matchSoftClaimsLight } from "./matchers/semantic-matcher.ts";
import {
  selectCandidateAtoms,
  validateLlmJudgeResponse,
} from "./llm-judge.ts";

// Re-eksporter alt nyttig
export type {
  AtomLike,
  ClaimMatch,
  ExtractedClaim,
  GuardMode,
  GuardResult,
  LlmJudgeClient,
  LlmJudgeInput,
  LlmJudgeResponse,
  MatchVerdict,
} from "./types.ts";

export {
  buildLlmJudgePrompt,
  parseLlmJudgeResponse,
  validateLlmJudgeResponse,
  LLM_JUDGE_SYSTEM_PROMPT,
  LLM_JUDGE_MODEL_ENV,
  LLM_JUDGE_MAX_TOKENS,
  LLM_JUDGE_TEMPERATURE,
  selectCandidateAtoms,
} from "./llm-judge.ts";

export { extractAllClaims } from "./extractors/claim-extractor.ts";

// ---------------------------------------------------------------------------
// Versjon
// ---------------------------------------------------------------------------

export const GUARD_VERSION = "2.0.0";

function eligibleAtoms(atoms: AtomLike[]): {
  eligible: AtomLike[];
  excluded: string[];
  legacy: string[];
} {
  const eligible: AtomLike[] = [];
  const excluded: string[] = [];
  const legacy: string[] = [];
  for (const atom of atoms) {
    const isLegacy = atom.user_confirmed == null && atom.confidence == null;
    const isExplicitlyUnsafe =
      atom.user_confirmed === false ||
      atom.confidence === "inferred" ||
      atom.confidence === "imported";
    if (isExplicitlyUnsafe) excluded.push(atom.id);
    else {
      eligible.push(atom);
      if (isLegacy) legacy.push(atom.id);
    }
  }
  return { eligible, excluded, legacy };
}

// ---------------------------------------------------------------------------
// Fast mode — kun rule-based, ingen LLM
// ---------------------------------------------------------------------------

/**
 * Rask verifisering. Kun hard claims sjekkes eksakt; soft claims sjekkes
 * lettvekts mot atom-tekst med Jaccard-similaritet.
 *
 * Egnet for:
 * - Sanntid i UI under brukerens redigering
 * - Sjekk før visning av AI-output
 *
 * Ikke egnet for:
 * - Endelig pre-eksport-validering (bruk verifyAgainstAtomsFull)
 */
export function verifyAgainstAtoms(
  text: string,
  atoms: AtomLike[],
  options: { mode?: "fast" | "standard" } = {},
): GuardResult {
  const mode: GuardMode = options.mode ?? "fast";

  const scope = eligibleAtoms(atoms);
  const claims = extractAllClaims(text, scope.eligible);

  const hardMatches = matchHardClaims(claims, scope.eligible);
  const softMatches = matchSoftClaimsLight(claims, scope.eligible);

  const allMatches = [...hardMatches, ...softMatches];

  return buildResult(allMatches, mode, scope);
}

// ---------------------------------------------------------------------------
// Full mode — bruker LLM-judge for soft claims
// ---------------------------------------------------------------------------

/**
 * Fullstendig verifikasjon med LLM-judge for soft claims og partial-treff.
 * Krever LlmJudgeClient injisert (Edge-funksjon implementerer denne med
 * Anthropic SDK).
 *
 * Egnet for:
 * - Pre-eksport-validering av master-CV
 * - Pre-sending-validering av jobbtilpasset CV
 * - Validering av AI-genererte søknadsbrev
 */
export async function verifyAgainstAtomsFull(
  text: string,
  atoms: AtomLike[],
  judgeClient: LlmJudgeClient,
  options: { language?: "no" | "en" } = {},
): Promise<GuardResult> {
  const language = options.language ?? "no";

  const scope = eligibleAtoms(atoms);
  const claims = extractAllClaims(text, scope.eligible);

  const hardMatches = matchHardClaims(claims, scope.eligible);
  const softLightMatches = matchSoftClaimsLight(claims, scope.eligible);

  // For partial og unverified soft matches, kjør LLM-judge
  const refinedSoftMatches: ClaimMatch[] = [];
  for (const match of softLightMatches) {
    if (match.verdict === "verified" && match.confidence >= 0.7) {
      // Allerede sterk match — hopp over LLM
      refinedSoftMatches.push(match);
      continue;
    }

    // Send til LLM-judge
    const candidates = selectCandidateAtoms(match.claim, scope.eligible, 5);
    if (candidates.length === 0) {
      // Ingen relevante atoms — behold light-resultat
      refinedSoftMatches.push(match);
      continue;
    }

    try {
      const rawJudgeResult = await judgeClient.judge({
        claim: match.claim,
        candidate_atoms: candidates,
        language,
      });
      const judgeResult = validateLlmJudgeResponse(rawJudgeResult, candidates);
      refinedSoftMatches.push({
        claim: match.claim,
        verdict: judgeResult.verdict,
        confidence: judgeResult.confidence,
        supporting_atom_ids: judgeResult.supporting_atom_ids,
        reasoning: judgeResult.reasoning,
      });
    } catch (e) {
      // LLM feilet — behold konservativt resultat med lavere konfidens
      refinedSoftMatches.push({
        ...match,
        confidence: Math.max(0, match.confidence - 0.2),
        reasoning: `${match.reasoning} (LLM-judge feilet: ${(e as Error).message})`,
      });
    }
  }

  // For hard claims med partial-verdict, kan også sendes til LLM for ekstra vurdering
  const refinedHardMatches: ClaimMatch[] = [];
  for (const match of hardMatches) {
    if (match.verdict === "partial") {
      const candidates = selectCandidateAtoms(match.claim, scope.eligible, 5);
      if (candidates.length > 0) {
        try {
          const rawJudgeResult = await judgeClient.judge({
            claim: match.claim,
            candidate_atoms: candidates,
            language,
          });
          const judgeResult = validateLlmJudgeResponse(rawJudgeResult, candidates);
          refinedHardMatches.push({
            claim: match.claim,
            verdict: judgeResult.verdict,
            confidence: judgeResult.confidence,
            supporting_atom_ids: judgeResult.supporting_atom_ids,
            reasoning: judgeResult.reasoning,
          });
          continue;
        } catch {
          // Fallback til rule-based
        }
      }
    }
    refinedHardMatches.push(match);
  }

  return buildResult([...refinedHardMatches, ...refinedSoftMatches], "strict", scope);
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function buildResult(
  matches: ClaimMatch[],
  mode: GuardMode,
  scope: { eligible: AtomLike[]; excluded: string[]; legacy: string[] },
): GuardResult {
  const unverified = matches.filter((m) => m.verdict === "unverified");
  const contradicted = matches.filter((m) => m.verdict === "contradicted");
  const partial = matches.filter((m) => m.verdict === "partial");
  const verified = matches.filter((m) => m.verdict === "verified");

  const hardCount = matches.filter((m) => m.claim.is_hard).length;
  const softCount = matches.filter((m) => !m.claim.is_hard).length;

  return {
    ok: unverified.length === 0 && contradicted.length === 0,
    mode,
    matches,
    unverified,
    contradicted,
    partial,
    stats: {
      total: matches.length,
      hard: hardCount,
      soft: softCount,
      verified: verified.length,
    },
    guard_version: GUARD_VERSION,
    evidence_scope: {
      eligible_atom_count: scope.eligible.length,
      excluded_atom_ids: scope.excluded,
      legacy_atom_ids: scope.legacy,
    },
    warnings: scope.legacy.length > 0
      ? ["Legacy-atoms uten eksplisitt confidence/user_confirmed ble brukt. Backend bør migrere metadata."]
      : [],
  };
}

/**
 * Generer menneskelig sammendrag av guard-resultat.
 */
export function summarizeGuardResult(
  result: GuardResult,
  language: "no" | "en" = "no",
): string {
  if (result.ok && result.partial.length === 0) {
    return language === "no"
      ? `Alle ${result.stats.total} påstander er verifisert mot evidens-grafen.`
      : `All ${result.stats.total} claims verified against evidence graph.`;
  }

  const parts: string[] = [];
  if (result.contradicted.length > 0) {
    parts.push(
      language === "no"
        ? `${result.contradicted.length} påstand(er) motsies av atoms`
        : `${result.contradicted.length} claim(s) contradicted by atoms`,
    );
  }
  if (result.unverified.length > 0) {
    parts.push(
      language === "no"
        ? `${result.unverified.length} ubekreftet`
        : `${result.unverified.length} unverified`,
    );
  }
  if (result.partial.length > 0) {
    parts.push(
      language === "no"
        ? `${result.partial.length} delvis match`
        : `${result.partial.length} partial match`,
    );
  }

  return parts.join(", ") + ".";
}
