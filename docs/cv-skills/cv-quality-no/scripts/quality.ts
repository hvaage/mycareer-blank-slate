// cv-quality-no — Hovedmotor
// Eneste fil Edge-funksjoner og frontend trenger å importere.

import type {
  CheckInput,
  QualityCheckResult,
  QualityIssue,
  RewriteClient,
  RewriteRequest,
  RewriteResponse,
  TextContext,
} from "./types.ts";

import { checkVerbStrength } from "./checks/verb-strength.ts";
import { checkTenseConsistency } from "./checks/tense-consistency.ts";
import { checkAiTells } from "./checks/ai-tells.ts";
import { checkCliches } from "./checks/cliches.ts";
import { checkReadability, computeStats } from "./checks/readability.ts";
import { checkRepetition } from "./checks/repetition.ts";

// ---------------------------------------------------------------------------
// Re-eksporter alt nyttig
// ---------------------------------------------------------------------------

export type {
  CheckInput,
  QualityCategory,
  QualityCheckResult,
  QualityIssue,
  QualitySeverity,
  RewriteClient,
  RewriteRequest,
  RewriteResponse,
  TextContext,
  RewriteValidationResult,
} from "./types.ts";

export { validateRewriteResponse } from "./rewrite-validator.ts";

export const QUALITY_VERSION = "2.0.0";

// ---------------------------------------------------------------------------
// Hovedfunksjon: synkron sjekk
// ---------------------------------------------------------------------------

/**
 * Kjør alle kvalitetssjekker på en tekst og returner alle issues.
 *
 * Synkron — ingen LLM-kall. Egnet for sanntid i UI eller pre-eksport-validering.
 */
export function checkQuality(input: CheckInput): QualityCheckResult {
  const issues: QualityIssue[] = [
    ...checkVerbStrength(input),
    ...checkTenseConsistency(input),
    ...checkAiTells(input),
    ...checkCliches(input),
    ...checkReadability(input),
    ...checkRepetition(input),
  ];

  const critical = issues.filter((i) => i.severity === "critical");
  const important = issues.filter((i) => i.severity === "important");
  const minor = issues.filter((i) => i.severity === "minor");
  const infos = issues.filter((i) => i.severity === "info");

  return {
    ok: critical.length === 0 && important.length === 0,
    issues,
    critical,
    important,
    minor,
    infos,
    stats: computeStats(input.text),
  };
}

// ---------------------------------------------------------------------------
// Batch-sjekk for hele CV
// ---------------------------------------------------------------------------

export interface CvQualityInput {
  language: "no" | "en";
  summary?: string;
  roles: {
    is_current: boolean;
    description?: string | null;
    achievements: string[];
  }[];
}

export interface CvQualityResult {
  ok: boolean;
  summary_issues: QualityIssue[];
  role_issues: {
    role_index: number;
    description_issues: QualityIssue[];
    achievement_issues: { index: number; issues: QualityIssue[] }[];
  }[];
  total_critical: number;
  total_important: number;
  total_minor: number;
}

/**
 * Sjekk hele CV-utkastet — sammendrag, rolle-beskrivelser og alle bullets.
 * Setter sibling_texts korrekt for repetisjon- og tense-sjekk.
 */
export function checkCvQuality(input: CvQualityInput): CvQualityResult {
  const result: CvQualityResult = {
    ok: true,
    summary_issues: [],
    role_issues: [],
    total_critical: 0,
    total_important: 0,
    total_minor: 0,
  };

  // Sjekk sammendrag
  if (input.summary) {
    const summaryResult = checkQuality({
      text: input.summary,
      language: input.language,
      context: "summary",
    });
    result.summary_issues = summaryResult.issues;
    result.total_critical += summaryResult.critical.length;
    result.total_important += summaryResult.important.length;
    result.total_minor += summaryResult.minor.length;
  }

  // Sjekk hver rolle
  input.roles.forEach((role, roleIdx) => {
    const roleResult: CvQualityResult["role_issues"][0] = {
      role_index: roleIdx,
      description_issues: [],
      achievement_issues: [],
    };

    // Rolle-beskrivelse
    if (role.description) {
      const descResult = checkQuality({
        text: role.description,
        language: input.language,
        context: "role_description",
        is_current_role: role.is_current,
      });
      roleResult.description_issues = descResult.issues;
      result.total_critical += descResult.critical.length;
      result.total_important += descResult.important.length;
      result.total_minor += descResult.minor.length;
    }

    // Achievements
    role.achievements.forEach((achievement, aIdx) => {
      const siblings = role.achievements.filter((_, i) => i !== aIdx);
      const achievementResult = checkQuality({
        text: achievement,
        language: input.language,
        context: "achievement",
        is_current_role: role.is_current,
        sibling_texts: siblings,
      });
      roleResult.achievement_issues.push({
        index: aIdx,
        issues: achievementResult.issues,
      });
      result.total_critical += achievementResult.critical.length;
      result.total_important += achievementResult.important.length;
      result.total_minor += achievementResult.minor.length;
    });

    result.role_issues.push(roleResult);
  });

  result.ok = result.total_critical === 0 && result.total_important === 0;

  return result;
}

// ---------------------------------------------------------------------------
// Rewrite — krever LLM-klient
// ---------------------------------------------------------------------------

/**
 * Be om forbedret formulering basert på issues.
 * Krever RewriteClient (Edge-funksjon implementerer med Anthropic SDK).
 */
export async function suggestRewrite(
  request: RewriteRequest,
  client: RewriteClient,
): Promise<RewriteResponse> {
  return client.rewrite(request);
}

// ---------------------------------------------------------------------------
// Rewrite-prompt-mal — Edge-funksjonen kan bruke direkte
// ---------------------------------------------------------------------------

export const REWRITE_SYSTEM_PROMPT_NO = `Du forbedrer formuleringer i norsk CV-tekst. Du følger disse reglene strengt:

1. Bruk korte, tydelige setninger. Maks 18 ord per bullet.
2. Aktiv form, ikke passiv.
3. Sterke åpningsverb (Etablerte, Bygde, Ledet, Drev, Vant, Lanserte).
4. Ingen overdrevne adjektiver (dynamisk, innovativ, exceptional).
5. Ingen AI-fluff ("har spilt en avgjørende rolle", "transformerte landskapet").
6. Ingen klisjéer ("med fokus på resultater", "datadreven beslutningsproses").
7. Behold alle konkrete fakta — du fjerner ikke tall, datoer eller selskapsnavn.
8. Behold verb-tid (preteritum for tidligere roller, presens for nåværende).
9. Norsk tegnsetting og format. Komma som desimalskille. Mellomrom som tusenskille.
10. Ingen semikolon.
11. Behold styrkegrad og eierskap. «Bidro til» blir aldri «ledet».
12. Ikke splitt norske sammensatte fagord hvis betydningen endres.
13. Bruk bare supporting_atom_ids fra input.
14. Sett alltid requires_guard=true.

Output kun JSON i dette eksakte formatet:
{
  "rewritten_text": "...",
  "changes_made": ["kort beskrivelse av endring 1", "..."],
  "supporting_atom_ids": ["..."],
  "preserved_claims": ["..."],
  "introduced_claims": [],
  "requires_guard": true
}`;

export const REWRITE_SYSTEM_PROMPT_EN = `You improve phrasing in English CV text. Follow these rules strictly:

1. Use short, clear sentences. Max 18 words per bullet.
2. Active voice, not passive.
3. Strong opening verbs (Established, Built, Led, Drove, Won, Launched).
4. No exaggerated adjectives (dynamic, innovative, exceptional).
5. No AI fluff ("played a critical role", "transformed the landscape").
6. No clichés ("results-driven", "data-driven decision making").
7. Preserve all concrete facts — never remove numbers, dates, company names.
8. Preserve verb tense (past for previous roles, present for current).
9. Preserve ownership and claim strength. Never upgrade contribution to leadership.
10. Use only supporting_atom_ids from the input and set requires_guard=true.

Output JSON only in this exact format:
{
  "rewritten_text": "...",
  "changes_made": ["short description of change 1", "..."],
  "supporting_atom_ids": ["..."],
  "preserved_claims": ["..."],
  "introduced_claims": [],
  "requires_guard": true
}`;

export function buildRewriteUserPrompt(request: RewriteRequest): string {
  const issuesText = request.issues
    .map((i) => `- [${i.severity}] ${i.message}${i.suggestion ? ` (${i.suggestion})` : ""}`)
    .join("\n");

  return `Original tekst:
"${request.original_text}"

Identifiserte problemer:
${issuesText}

Tillatte supporting_atom_ids:
${request.supporting_atom_ids.join(", ")}

Påstander som skal bevares:
${request.source_claims.map((claim) => "- " + claim).join("\n")}

Foreslå én forbedret formulering som retter problemene uten å endre fakta,
eierskap eller styrkegrad. Returner den utvidede JSON-kontrakten.`;
}

// ---------------------------------------------------------------------------
// Sammendrag for UI
// ---------------------------------------------------------------------------

export function summarizeQualityResult(
  result: QualityCheckResult,
  language: "no" | "en" = "no",
): string {
  if (result.ok && result.minor.length === 0) {
    return language === "no"
      ? "Ingen kvalitetsproblemer funnet."
      : "No quality issues found.";
  }

  const parts: string[] = [];
  if (result.critical.length > 0) {
    parts.push(
      language === "no"
        ? `${result.critical.length} kritisk problem${result.critical.length > 1 ? "er" : ""}`
        : `${result.critical.length} critical issue${result.critical.length > 1 ? "s" : ""}`,
    );
  }
  if (result.important.length > 0) {
    parts.push(
      language === "no"
        ? `${result.important.length} viktig${result.important.length > 1 ? "e" : ""}`
        : `${result.important.length} important`,
    );
  }
  if (result.minor.length > 0) {
    parts.push(
      language === "no"
        ? `${result.minor.length} mindre`
        : `${result.minor.length} minor`,
    );
  }

  return parts.join(", ") + ".";
}
