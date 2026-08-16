// cv-hallucination-guard — LLM judge
// Bygger Claude API-prompt for soft-claim-vurdering og parser response.
//
// Selve API-kallet håndteres av Edge-funksjonen (som har anthropic-SDK + API-key).
// Denne filen eksporterer prompt-builder og response-parser.

import type {
  AtomLike,
  ExtractedClaim,
  LlmJudgeInput,
  LlmJudgeResponse,
  ValidatedLlmJudgeResponse,
  MatchVerdict,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Prompt-builder
// ---------------------------------------------------------------------------

export const LLM_JUDGE_SYSTEM_PROMPT = `Du er en streng faktasjekker for CV-tekst på norsk og engelsk.

Din oppgave er å sjekke om en spesifikk påstand fra en CV-bullet er støttet av oppgitte atoms (verifiserte fakta fra brukerens evidens-graf).

Regler:
1. Du verifiserer KUN mot oppgitte atoms. Du gjetter aldri.
2. Avrunding ned til 20 % er OK. Eskalasjon (claim er større enn atom) er IKKE OK.
3. Sterkere verb i claim enn i atom (f.eks. "ledet" når atom sier "bidro til") er IKKE OK.
4. Manglende presisjon i claim ("team" når atom sier "team på 27") er OK.
5. Hvis claim inneholder fakta-detaljer som ikke står i noen atom, er det IKKE verifisert.
6. Sammenstilling av flere atoms til én bullet er OK så lenge alle elementer er støttet.
7. Norske parafraser og sammensatte ord kan uttrykke samme handling, men aldri
   oppgrader «bidro til» eller «ansvar for» til «ledet», «eide» eller et resultat.
8. Verdict verified krever minst én supporting_atom_id fra listen du fikk.

Output kun JSON i dette eksakte formatet, ingen tekst rundt:
{
  "verdict": "verified" | "partial" | "unverified" | "contradicted",
  "confidence": 0.0-1.0,
  "reasoning": "kort forklaring på norsk, maks 2 setninger",
  "supporting_atom_ids": ["atom-id-1", ...]
}`;

export function buildLlmJudgePrompt(input: LlmJudgeInput): string {
  const atomsBlock = input.candidate_atoms
    .map((a) => formatAtomForPrompt(a))
    .join("\n\n");

  return `Påstand som skal verifiseres:
"${input.claim.text}"

Type: ${input.claim.type}
Språk: ${input.language === "no" ? "norsk" : "engelsk"}

Tilgjengelige atoms (verifiserte fakta):

${atomsBlock}

Vurder påstanden mot atoms over og returner JSON-output i henhold til reglene.`;
}

function formatAtomForPrompt(atom: AtomLike): string {
  const sd = atom.structured_data ?? {};
  const content = atom.content_no ?? atom.content_en ?? "";
  return `--- ATOM ${atom.id} (type: ${atom.atom_type}) ---
Content: ${content}
Structured data: ${JSON.stringify(sd, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Response-parser
// ---------------------------------------------------------------------------

export function parseLlmJudgeResponse(rawText: string): LlmJudgeResponse {
  // Trekk ut JSON fra teksten — Claude kan noen ganger inkludere markdown-fences
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `LLM judge returnerte ikke gyldig JSON: ${(e as Error).message}. Raw: ${rawText.slice(0, 200)}`,
    );
  }

  const verdict = parsed.verdict;
  const validVerdicts: MatchVerdict[] = [
    "verified", "partial", "unverified", "contradicted",
  ];
  if (!validVerdicts.includes(verdict as MatchVerdict)) {
    throw new Error(`Ugyldig verdict fra LLM judge: ${String(verdict)}`);
  }

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
  const supportingAtomIds = Array.isArray(parsed.supporting_atom_ids)
    ? parsed.supporting_atom_ids.filter((x): x is string => typeof x === "string")
    : [];

  return {
    verdict: verdict as MatchVerdict,
    confidence: Math.max(0, Math.min(1, confidence)),
    reasoning,
    supporting_atom_ids: supportingAtomIds,
  };
}

export function validateLlmJudgeResponse(
  response: LlmJudgeResponse,
  candidateAtoms: AtomLike[],
): ValidatedLlmJudgeResponse {
  const allowed = new Set(candidateAtoms.map((atom) => atom.id));
  const validIds = response.supporting_atom_ids.filter((id) => allowed.has(id));
  const invalidIds = response.supporting_atom_ids.filter((id) => !allowed.has(id));
  const needsEvidence = response.verdict === "verified" || response.verdict === "partial";
  return {
    ...response,
    verdict: needsEvidence && validIds.length === 0 ? "unverified" : response.verdict,
    confidence: needsEvidence && validIds.length === 0
      ? Math.min(response.confidence, 0.49)
      : response.confidence,
    reasoning: needsEvidence && validIds.length === 0
      ? response.reasoning + " Ingen gyldig supporting_atom_id ble returnert."
      : response.reasoning,
    supporting_atom_ids: validIds,
    invalid_supporting_atom_ids: invalidIds,
  };
}

// ---------------------------------------------------------------------------
// Anbefalt model-config (referanseverdier for Edge-funksjon)
// ---------------------------------------------------------------------------

/** Modell-id velges i Edge Function-konfigurasjon og logges per model run. */
export const LLM_JUDGE_MODEL_ENV = "CLAUDE_MODEL_GUARD";
export const LLM_JUDGE_MAX_TOKENS = 500;
export const LLM_JUDGE_TEMPERATURE = 0.0; // deterministisk verdict ønsket

// ---------------------------------------------------------------------------
// Kandidat-utvelgelse
// ---------------------------------------------------------------------------

/**
 * Velg de mest relevante atoms for LLM-judge basert på claim.
 * Reduserer prompt-størrelse og kostnad.
 */
export function selectCandidateAtoms(
  claim: ExtractedClaim,
  allAtoms: AtomLike[],
  maxCandidates = 5,
): AtomLike[] {
  // Score atoms etter overlapp med claim
  const scored = allAtoms.map((atom) => ({
    atom,
    score: scoreAtomForClaim(atom, claim),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, maxCandidates)
    .filter((s) => s.score > 0)
    .map((s) => s.atom);
}

function scoreAtomForClaim(atom: AtomLike, claim: ExtractedClaim): number {
  const haystack = `${atom.content_no ?? ""} ${atom.content_en ?? ""}`.toLowerCase();
  const claimText = claim.text.toLowerCase();
  const claimTokens = claimText.split(/\s+/).filter((t) => t.length > 2);

  let score = 0;
  for (const token of claimTokens) {
    if (haystack.includes(token)) score += 1;
  }

  // Bonus for relevante atom-typer
  if (claim.type === "number") {
    if (atom.atom_type === "metric" || atom.atom_type === "achievement") {
      score += 0.5;
    }
  }
  if (claim.type === "date") {
    if (atom.atom_type === "role" || atom.atom_type === "education") {
      score += 0.5;
    }
  }
  if (claim.type === "verb_action" && atom.atom_type === "achievement") {
    score += 0.5;
  }

  return score;
}
