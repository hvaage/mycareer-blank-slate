import type {
  RewriteRequest,
  RewriteResponse,
  RewriteValidationResult,
} from "./types.ts";

function hardTokens(text: string): Set<string> {
  const tokens = text.match(
    /(?:NOK|USD|EUR|GBP)\s*[\d., ]+|\b\d{4}\b|\b\d+(?:[.,]\d+)?\s*%|\b\d+(?:[.,]\d+)?\b/giu,
  ) ?? [];
  return new Set(tokens.map((token) => token.replace(/\s+/g, " ").trim().toLocaleLowerCase("nb-NO")));
}

export function validateRewriteResponse(
  request: RewriteRequest,
  response: RewriteResponse,
): RewriteValidationResult {
  const before = hardTokens(request.original_text);
  const after = hardTokens(response.rewritten_text);
  const missingHardTokens = [...before].filter((token) => !after.has(token));
  const introducedHardTokens = [...after].filter((token) => !before.has(token));
  const missingRequiredClaims = request.source_claims.filter(
    (claim) => !response.preserved_claims.includes(claim),
  );
  const allowedAtomIds = new Set(request.supporting_atom_ids);
  const invalidAtomIds = response.supporting_atom_ids.filter((id) => !allowedAtomIds.has(id));
  return {
    ok:
      response.requires_guard === true &&
      missingHardTokens.length === 0 &&
      introducedHardTokens.length === 0 &&
      missingRequiredClaims.length === 0 &&
      invalidAtomIds.length === 0 &&
      response.introduced_claims.length === 0,
    missing_hard_tokens: missingHardTokens,
    introduced_hard_tokens: introducedHardTokens,
    missing_required_claims: missingRequiredClaims,
    invalid_atom_ids: invalidAtomIds,
  };
}
