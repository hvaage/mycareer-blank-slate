import type {
  AtsRelevanceResult,
  CandidateEvidenceTerm,
  KeywordMatch,
  TargetKeyword,
} from "./types.ts";

const WEIGHTS = { required: 3, preferred: 2, context: 1 } as const;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("nb-NO")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function evaluateKeywordCoverage(
  keywords: TargetKeyword[],
  evidenceTerms: CandidateEvidenceTerm[],
): AtsRelevanceResult {
  const eligible = evidenceTerms.filter((term) => term.user_confirmed);
  const matches: KeywordMatch[] = keywords.map((keyword) => {
    const target = normalize(keyword.term);
    const targetAliases = new Set([target, ...keyword.aliases.map(normalize)]);
    for (const evidence of eligible) {
      const evidenceTerm = normalize(evidence.term);
      const evidenceAliases = new Set(evidence.aliases.map(normalize));
      if (evidenceTerm === target) {
        return { keyword, status: "exact", matched_term: evidence.term, supporting_atom_ids: evidence.atom_ids };
      }
      if (targetAliases.has(evidenceTerm)) {
        return { keyword, status: "normalized", matched_term: evidence.term, supporting_atom_ids: evidence.atom_ids };
      }
      if ([...evidenceAliases].some((alias) => targetAliases.has(alias))) {
        return { keyword, status: "semantic_alias", matched_term: evidence.term, supporting_atom_ids: evidence.atom_ids };
      }
    }
    return { keyword, status: "unsupported", matched_term: null, supporting_atom_ids: [] };
  });

  const supported = matches.filter((match) => match.status !== "unsupported");
  const unsupported = matches.filter((match) => match.status === "unsupported");
  const totalWeighted = matches.reduce((sum, match) => sum + WEIGHTS[match.keyword.importance], 0);
  const supportedWeighted = supported.reduce((sum, match) => sum + WEIGHTS[match.keyword.importance], 0);
  return {
    matches,
    supported,
    unsupported,
    coverage_percent: totalWeighted === 0 ? 100 : Math.round((supportedWeighted / totalWeighted) * 1000) / 10,
    exact_count: matches.filter((match) => match.status === "exact").length,
    supported_count: supported.length,
    total_weighted: totalWeighted,
    supported_weighted: supportedWeighted,
    rule: "never_add_unsupported_keyword",
  };
}
