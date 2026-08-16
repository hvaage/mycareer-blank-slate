// Minimal Deno-modul som verifiserer at de delte CV-skill-modulene kan
// importeres i Edge-runtimen. Ingen nettverkskall, ingen databasetilgang.
// Brukes av importverifikasjonen i fase 1 (ikke en deployet funksjon).

import { sanitizeRequestOptions } from "../claude/client.ts";
import { assessReadiness, isEligibleAtom } from "./adapters/career-atom-adapter.ts";
import { READINESS_STATUSES } from "./contract.ts";
import { evaluateKeywordCoverage } from "./vendor/cv-ats-rules-no/scripts/keyword-coverage.ts";

export function selftest() {
  return {
    ok: true,
    readiness: assessReadiness({ rows: [] }).status,
    statuses: READINESS_STATUSES,
    eligibilityLoaded: typeof isEligibleAtom === "function",
    claudeSanitizerLoaded: typeof sanitizeRequestOptions === "function",
    atsLoaded: typeof evaluateKeywordCoverage === "function",
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(selftest()));
}
