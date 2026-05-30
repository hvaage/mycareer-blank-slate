// @ts-nocheck
/**
 * Provider-neutral copy and error shaping for end-user UX.
 * @see docs/ai-provider-abstraction.md
 */

/** Marker: routing and SDK details stay internal to the codebase. */
export const AI_PROVIDER_INTERNAL_ONLY = true;

export const AI_UX_GENERIC_FAILURE =
  "AI-tjenesten kunne ikke fullføre forespørselen akkurat nå. Prøv igjen om litt.";

export const AI_UX_RATE_LIMIT =
  "AI-tjenesten er midlertidig opptatt. Prøv igjen om litt.";

export const AI_UX_OVER_CAPACITY =
  "AI-analysen bruker mer kapasitet enn tilgjengelig akkurat nå.";

export const AI_UX_MATCH_FAILED = "AI-match kunne ikke fullføres akkurat nå.";

export const AI_UX_ANALYSIS_FAILED =
  "AI-analysen kunne ikke fullføres akkurat nå. Prøv igjen om litt.";

export const AI_UX_COVER_LETTER_FAILED =
  "AI-generering av søknadsbrev kunne ikke fullføres akkurat nå. Prøv igjen om litt.";

/** Short labels for in-flight AI work (UI progress, not tied to a vendor). */
export const AI_JOB_LABEL_RESEARCHING = "AI søker på nettet…";
export const AI_JOB_LABEL_GENERATING = "AI genererer innhold…";
export const AI_JOB_LABEL_MATCHING = "AI beregner kandidatmatch…";

function mentionsProviderOrModel(t: string): boolean {
  const l = t.toLowerCase();
  return (
    /\bclaude\b/.test(l) ||
    /\banthropic\b/.test(l) ||
    /\bopenai\b/.test(l) ||
    /\bchatgpt\b/.test(l) ||
    /\bsonnet\b/.test(l) ||
    /\bgpt-?\d/.test(l) ||
    /claude-[\w-]+/i.test(t)
  );
}

function looksLikeRateLimit(t: string): boolean {
  const l = t.toLowerCase();
  return (
    l.includes("rate limit") ||
    l.includes("429") ||
    l.includes("tpm") ||
    l.includes("tokens per minute") ||
    l.includes("requests per minute") ||
    l.includes("too many requests") ||
    l.includes("for mange ai-kall")
  );
}

function looksLikeTimeout(t: string): boolean {
  const l = t.toLowerCase();
  return l.includes("timeout") || l.includes("timed out") || l.includes("tidsavbrudd");
}

function looksLikePaymentOrQuota(t: string): boolean {
  const l = t.toLowerCase();
  return (
    l.includes("402") ||
    l.includes("payment") ||
    l.includes("kvote") ||
    l.includes("credit balance") ||
    l.includes("billing")
  );
}

/**
 * Map raw provider/HTTP messages to stable Norwegian UX copy.
 * Safe to call on any string shown after Edge `invoke` or job `error_message`.
 */
export function normalizeAiErrorMessage(
  raw: string | null | undefined,
  opts?: { kind?: "generic" | "analysis" | "match" | "cover_letter" },
): string {
  const t = (raw ?? "").trim();
  const kind = opts?.kind ?? "generic";

  const pickDefault = () => {
    switch (kind) {
      case "analysis":
        return AI_UX_ANALYSIS_FAILED;
      case "match":
        return AI_UX_MATCH_FAILED;
      case "cover_letter":
        return AI_UX_COVER_LETTER_FAILED;
      default:
        return AI_UX_GENERIC_FAILURE;
    }
  };

  if (!t) return pickDefault();

  if (looksLikeRateLimit(t)) return AI_UX_RATE_LIMIT;
  if (looksLikePaymentOrQuota(t)) {
    return "AI-kvoten er brukt opp eller krever oppmerksomhet. Kontakt support om problemet vedvarer.";
  }
  if (looksLikeTimeout(t)) {
    return "AI-analysen brukte for lang tid. Prøv igjen med mindre innhold eller senere.";
  }

  if (mentionsProviderOrModel(t) || /^anthropic\s+\d{3}:/i.test(t)) {
    return pickDefault();
  }

  // Long technical blobs (stack fragments, JSON) — avoid showing verbatim.
  if (t.length > 400 || (t.includes("{") && t.includes("error"))) {
    return pickDefault();
  }

  return t.length > 600 ? `${t.slice(0, 597)}…` : t;
}
