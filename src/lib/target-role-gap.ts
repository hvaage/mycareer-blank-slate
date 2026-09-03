/**
 * Deterministisk gap-analyse mot en målrolle.
 *
 * Ingen KI: kravene kommer fra ESCO-kildene som Markedsinnsikt allerede bruker,
 * og treffene beregnes ved ordoverlapp mot brukerens brukerbekreftede
 * `career_atoms`. Samme modul brukes både i grensesnittet og på serveren, slik
 * at det som vises og det som lagres alltid er beregnet likt.
 */

export const TARGET_ROLE_GAP_VERSION = "target_role_gap_v1_2026_09_03";

export type RoleRequirementLevel = "must_have" | "nice_to_have";

export type RoleRequirement = {
  uri: string | null;
  label: string;
  level: RoleRequirementLevel;
};

export type GapAtom = {
  id: string;
  label: string;
  description: string | null;
  strength: number | null;
};

export type RequirementAssessment = {
  uri: string | null;
  label: string;
  level: RoleRequirementLevel;
  covered: boolean;
  matches: { id: string; label: string }[];
};

export type TargetRoleGapResult = {
  role: { title: string; uri: string | null };
  version: string;
  requirements: RequirementAssessment[];
  mustHaveTotal: number;
  mustHaveCovered: number;
  niceToHaveTotal: number;
  niceToHaveCovered: number;
  coverageScore0to100: number;
  band: "weak" | "moderate" | "strong";
  missingMustHave: RequirementAssessment[];
  missingNiceToHave: RequirementAssessment[];
  coveredHighlights: RequirementAssessment[];
};

const STOPWORDS = new Set([
  "og",
  "eller",
  "for",
  "med",
  "til",
  "fra",
  "som",
  "det",
  "den",
  "der",
  "ved",
  "ulike",
  "ulik",
  "andre",
  "annet",
  "bruke",
  "bruk",
  "sikre",
  "gjennomfore",
  "utfore",
  "arbeide",
  "arbeid",
  "innen",
  "over",
  "under",
  "etter",
  "samt",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "use",
  "using",
  "work",
  "working",
  "ensure",
  "perform",
]);

export function normalizeTerm(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

const SHORT_KEEP = new Set([
  "hr",
  "bi",
  "ki",
  "ai",
  "ml",
  "ux",
  "ui",
  "qa",
  "pr",
  "sql",
  "erp",
  "crm",
  "seo",
  "sem",
  "api",
  "b2b",
  "b2c",
  "iso",
  "c++",
  "c#",
]);

/** Generiske handlingsverb i ESCO-krav. De bærer ikke innholdet i kravet. */
const GENERIC_VERBS = new Set([
  "administrere",
  "administrasjon",
  "analysere",
  "analyse",
  "utvikle",
  "utvikling",
  "planlegge",
  "planlegging",
  "gjennomfore",
  "utarbeide",
  "handtere",
  "folge",
  "opprette",
  "etablere",
  "vedlikeholde",
  "overvake",
  "identifisere",
  "koordinere",
  "manage",
  "analyse",
  "develop",
  "plan",
  "maintain",
  "monitor",
]);

/** Uttrykk som betyr det samme, normalisert før ordoppdeling. */
const SYNONYM_PHRASES: [RegExp, string][] = [
  [/\bp l\b|\bprofit and loss\b|\bresultatansvar\b|\bbunnlinje\b|\bebitda\b|\bmargin\b/g, "lonnsomhet"],
  [/\bomsetning\b|\brevenue\b|\barr\b|\bsalgsinntekt\b/g, "salg"],
  [/\bansatte\b|\bpersonale\b|\bteamet\b|\bteam\b|\bmedarbeidere\b/g, "medarbeider"],
  [/\brekruttering\b|\bansettelse\b|\bansette\b/g, "rekruttere"],
  [/\bkunder\b|\bkunde\b|\bkundeansvar\b/g, "kunde"],
  [/\bpartnere\b|\bpartnerskap\b|\bokosystem\b/g, "partner"],
  [/\bstrategisk\b|\bstrategien\b/g, "strategi"],
];

function canonicalize(text: string): string {
  let s = normalizeTerm(text);
  for (const [re, to] of SYNONYM_PHRASES) s = s.replace(re, to);
  return s;
}

/** Enkel norsk stammeform: kutt vanlige endelser og kort ned til stabil kjerne. */
function stem(token: string): string {
  let t = token;
  for (const suffix of ["ene", "ane", "enes", "ens", "er", "en", "et", "a"]) {
    if (t.length > 5 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return t.slice(0, 8);
}

function tokens(text: string, dropGenericVerbs = false): Set<string> {
  const out = new Set<string>();
  for (const raw of canonicalize(text).split(" ")) {
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    if (dropGenericVerbs && GENERIC_VERBS.has(raw)) continue;
    if (raw.length >= 4) out.add(stem(raw));
    else if (SHORT_KEEP.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Innholdsordene i et krav: handlingsverbet fjernes, slik at «administrere
 * lønnsomhet» sammenlignes på «lønnsomhet». Er kravet bare et verb, brukes
 * hele uttrykket.
 */
function requirementTokens(label: string): Set<string> {
  const content = tokens(label, true);
  return content.size > 0 ? content : tokens(label);
}

function matchesAtom(reqTokens: Set<string>, reqNorm: string, atomText: string): boolean {
  const atomNorm = canonicalize(atomText);
  if (!atomNorm) return false;
  if (reqNorm.length >= 6 && atomNorm.includes(reqNorm)) return true;
  const atomTokens = tokens(atomText);
  if (atomTokens.size === 0 || reqTokens.size === 0) return false;
  let hits = 0;
  for (const t of reqTokens) if (atomTokens.has(t)) hits += 1;
  // Ett innholdsord er nok for korte krav; sammensatte krav må ha to treff.
  const needed = reqTokens.size >= 3 ? 2 : 1;
  return hits >= needed;
}


export function computeTargetRoleGap(input: {
  role: { title: string; uri: string | null };
  requirements: RoleRequirement[];
  atoms: GapAtom[];
}): TargetRoleGapResult {
  const { role, atoms } = input;

  // Dedupliser krav på normalisert etikett; «må ha» vinner over «bra å ha».
  const byKey = new Map<string, RoleRequirement>();
  for (const req of input.requirements) {
    const label = req.label?.trim();
    if (!label) continue;
    const key = normalizeTerm(label);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || (existing.level === "nice_to_have" && req.level === "must_have")) {
      byKey.set(key, { ...req, label });
    }
  }

  const requirements: RequirementAssessment[] = [];
  for (const req of byKey.values()) {
    const reqNorm = normalizeTerm(req.label);
    const reqTokens = tokens(req.label);
    const matches = atoms
      .filter((a) => matchesAtom(reqTokens, reqNorm, `${a.label} ${a.description ?? ""}`))
      .slice(0, 5)
      .map((a) => ({ id: a.id, label: a.label }));
    requirements.push({
      uri: req.uri ?? null,
      label: req.label,
      level: req.level,
      covered: matches.length > 0,
      matches,
    });
  }

  requirements.sort((a, b) => {
    if (a.level !== b.level) return a.level === "must_have" ? -1 : 1;
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return a.label.localeCompare(b.label, "nb");
  });

  const must = requirements.filter((r) => r.level === "must_have");
  const nice = requirements.filter((r) => r.level === "nice_to_have");
  const mustCovered = must.filter((r) => r.covered).length;
  const niceCovered = nice.filter((r) => r.covered).length;

  const weightedTotal = must.length * 2 + nice.length;
  const weightedCovered = mustCovered * 2 + niceCovered;
  const coverage = weightedTotal === 0 ? 0 : Math.round((weightedCovered / weightedTotal) * 100);

  return {
    role,
    version: TARGET_ROLE_GAP_VERSION,
    requirements,
    mustHaveTotal: must.length,
    mustHaveCovered: mustCovered,
    niceToHaveTotal: nice.length,
    niceToHaveCovered: niceCovered,
    coverageScore0to100: coverage,
    band: coverage < 40 ? "weak" : coverage < 70 ? "moderate" : "strong",
    missingMustHave: must.filter((r) => !r.covered),
    missingNiceToHave: nice.filter((r) => !r.covered),
    coveredHighlights: must.filter((r) => r.covered),
  };
}

/** 0–100 dekningsgrad → 1–6 dimensjonsskala som resten av matchmodellen bruker. */
export function coverageToScore1to6(coverage: number): number {
  const c = Math.max(0, Math.min(100, Math.round(coverage)));
  return Math.max(1, Math.min(6, Math.round((c / 100) * 5) + 1));
}
