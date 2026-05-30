// @ts-nocheck
/**
 * Career Intelligence Module 2 — atom dimensions/categories and sources.
 * Preference atoms = what matters to the user; evidence atoms = what can be proven/sourced.
 */

import {
  MATCH_SCORE_MAX,
  MATCH_SCORE_MIN,
  clampMatchScore,
  matchScoreBand,
  matchScoreBandLabelNb,
  type MatchScoreBand,
} from "@/lib/career-match-dimensions";

export { MATCH_SCORE_MIN, MATCH_SCORE_MAX, clampMatchScore };

/** Canonical keys for preference rows (`user_preference_atoms.dimension`). */
export const PREFERENCE_ATOM_DIMENSION_IDS = [
  "industry",
  "company_size",
  "leadership_scope",
  "mission",
  "innovation",
  "sustainability",
  "compensation",
  "work_style",
  "work_life_balance",
  "location",
  "travel",
  "growth_stage",
  "stability",
  "learning",
  "autonomy",
  "culture",
  "network",
  "role_type",
] as const;

export type PreferenceAtomDimensionId = (typeof PREFERENCE_ATOM_DIMENSION_IDS)[number];

export type PreferenceAtomDimensionMeta = {
  id: PreferenceAtomDimensionId;
  labelNb: string;
  descriptionNb: string;
};

export const PREFERENCE_ATOM_DIMENSIONS: readonly PreferenceAtomDimensionMeta[] = [
  { id: "industry", labelNb: "Bransje", descriptionNb: "Hvilke bransjer eller domener tiltrekker deg." },
  { id: "company_size", labelNb: "Selskapsstørrelse", descriptionNb: "Startup, scaleup eller større organisasjon." },
  { id: "leadership_scope", labelNb: "Ledelsesomfang", descriptionNb: "Hvor mye ansvar og mandat du ønsker." },
  { id: "mission", labelNb: "Misjon", descriptionNb: "Mening og retning i arbeidet." },
  { id: "innovation", labelNb: "Innovasjon", descriptionNb: "Nyskapning, produkt og endringstakt." },
  { id: "sustainability", labelNb: "Bærekraft", descriptionNb: "ESG, etikk og langsiktig ansvar." },
  { id: "compensation", labelNb: "Kompensasjon", descriptionNb: "Lønn, bonus, eierskap." },
  { id: "work_style", labelNb: "Arbeidsmåte", descriptionNb: "Remote, hybrid, tempo og samarbeid." },
  { id: "work_life_balance", labelNb: "Livsbalanse", descriptionNb: "Balanse mellom jobb og privatliv." },
  { id: "location", labelNb: "Sted", descriptionNb: "Geografi og flytting." },
  { id: "travel", labelNb: "Reise", descriptionNb: "Hvor mye reising du er komfortabel med." },
  { id: "growth_stage", labelNb: "Vekstfase", descriptionNb: "Tidlig vekst vs modent selskap." },
  { id: "stability", labelNb: "Stabilitet", descriptionNb: "Forutsigbarhet vs endring." },
  { id: "learning", labelNb: "Læring", descriptionNb: "Utvikling, kurs og mentorskap." },
  { id: "autonomy", labelNb: "Autonomi", descriptionNb: "Frihet til å styre egen arbeidsform." },
  { id: "culture", labelNb: "Kultur", descriptionNb: "Verdier, trygghet og samspill." },
  { id: "network", labelNb: "Nettverk", descriptionNb: "Mulighet til å bygge relasjoner." },
  { id: "role_type", labelNb: "Rolletype", descriptionNb: "Fag, leder, spesialist osv." },
];

const PREF_DIM_BY_ID = Object.fromEntries(PREFERENCE_ATOM_DIMENSIONS.map((d) => [d.id, d])) as Record<
  PreferenceAtomDimensionId,
  PreferenceAtomDimensionMeta
>;

export function getPreferenceAtomDimensionMeta(id: string): PreferenceAtomDimensionMeta | null {
  return PREF_DIM_BY_ID[id as PreferenceAtomDimensionId] ?? null;
}

/** Canonical keys for evidence rows (`user_evidence_atoms.category`). */
export const EVIDENCE_ATOM_CATEGORY_IDS = [
  "leadership",
  "commercial",
  "operations",
  "finance",
  "industry",
  "technology",
  "communication",
  "strategy",
  "people",
  "governance",
  "project",
  "result",
  "certification",
  "education",
  "language",
  "network",
] as const;

export type EvidenceAtomCategoryId = (typeof EVIDENCE_ATOM_CATEGORY_IDS)[number];

export type EvidenceAtomCategoryMeta = {
  id: EvidenceAtomCategoryId;
  labelNb: string;
  descriptionNb: string;
};

export const EVIDENCE_ATOM_CATEGORIES: readonly EvidenceAtomCategoryMeta[] = [
  { id: "leadership", labelNb: "Ledelse", descriptionNb: "Team, mandat, beslutninger." },
  { id: "commercial", labelNb: "Kommersielt", descriptionNb: "Salg, marked, vekst." },
  { id: "operations", labelNb: "Drift", descriptionNb: "Leveranse, prosesser, kvalitet." },
  { id: "finance", labelNb: "Økonomi", descriptionNb: "Budsjett, P&L, investeringer." },
  { id: "industry", labelNb: "Bransje", descriptionNb: "Domeneekspertise." },
  { id: "technology", labelNb: "Teknologi", descriptionNb: "Systemer, data, produkt." },
  { id: "communication", labelNb: "Kommunikasjon", descriptionNb: "Presentasjon, skrift, stakeholders." },
  { id: "strategy", labelNb: "Strategi", descriptionNb: "Retning, prioritering, analyse." },
  { id: "people", labelNb: "Mennesker", descriptionNb: "HR, kultur, rekruttering." },
  { id: "governance", labelNb: "Styring", descriptionNb: "Risiko, compliance, styrearbeid." },
  { id: "project", labelNb: "Prosjekt", descriptionNb: "Leveranser med tydelig scope." },
  { id: "result", labelNb: "Resultat", descriptionNb: "Målbare utfall og effekt." },
  { id: "certification", labelNb: "Sertifisering", descriptionNb: "Formelle bevis." },
  { id: "education", labelNb: "Utdanning", descriptionNb: "Grader og institusjoner." },
  { id: "language", labelNb: "Språk", descriptionNb: "Arbeidsspråk og nivå." },
  { id: "network", labelNb: "Nettverk", descriptionNb: "Relasjoner og synlighet i feltet." },
];

const EVID_CAT_BY_ID = Object.fromEntries(EVIDENCE_ATOM_CATEGORIES.map((c) => [c.id, c])) as Record<
  EvidenceAtomCategoryId,
  EvidenceAtomCategoryMeta
>;

export function getEvidenceAtomCategoryMeta(id: string): EvidenceAtomCategoryMeta | null {
  return EVID_CAT_BY_ID[id as EvidenceAtomCategoryId] ?? null;
}

/** Allowed `source` values for atoms (extend as pipelines appear). */
export const ATOM_SOURCES = [
  "manual",
  "profile_sync",
  "cv",
  "linkedin",
  "application",
  "import",
] as const;

export type AtomSourceId = (typeof ATOM_SOURCES)[number];

export const ATOM_SOURCE_LABELS_NB: Record<AtomSourceId, string> = {
  manual: "Manuelt",
  profile_sync: "Fra karriereprofil",
  cv: "Fra CV",
  linkedin: "Fra LinkedIn",
  application: "Fra søknad",
  import: "Import",
};

/** Reuse global 1–6 bands from career-match-dimensions (weak / moderate / strong). */
export function atomScoreBand(score: number | null | undefined): MatchScoreBand | null {
  return matchScoreBand(score);
}

export function atomScoreBandLabelNb(band: MatchScoreBand): string {
  return matchScoreBandLabelNb(band);
}

export function clampAtomScore(n: number): number {
  return clampMatchScore(n);
}
