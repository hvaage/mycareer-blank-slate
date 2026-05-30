/**
 * Module 4.5 — target-side atoms (stillinger, arbeidsgivere, signaler).
 * Aligns conceptually with `career-atoms` (user) and `career-match-dimensions` (1–6 bands).
 */

import { clampMatchScore, matchScoreBand, matchScoreBandLabelNb, type MatchScoreBand } from "@/lib/career-match-dimensions";

export { clampMatchScore, matchScoreBand, matchScoreBandLabelNb };
export type { MatchScoreBand };

/** Requirement / capability tags for opportunity rows (`opportunity_requirement_atoms.category`). */
export const OPPORTUNITY_REQUIREMENT_CATEGORIES = [
  "leadership",
  "saas",
  "enterprise_sales",
  "norwegian_language",
  "transformation",
  "remote_work",
  "public_sector",
  "finance",
  "operations",
  "startup",
  "people_management",
  "technology",
  "strategy",
  "sales",
  "security",
  "data",
  "location",
  "compensation",
] as const;
export type OpportunityRequirementCategory = (typeof OPPORTUNITY_REQUIREMENT_CATEGORIES)[number];

/** Stable employer traits (`company_profile_atoms.category`). */
export const COMPANY_PROFILE_CATEGORIES = [
  "growth_company",
  "enterprise_company",
  "mission_driven",
  "sustainability_focus",
  "flat_structure",
  "global_company",
  "transformation_heavy",
  "engineering_culture",
  "high_autonomy",
  "process_heavy",
  "matrix_organization",
  "scaleup",
  "financial_stability",
  "culture_strength",
] as const;
export type CompanyProfileCategory = (typeof COMPANY_PROFILE_CATEGORIES)[number];

/** Short-lived hiring / momentum signals (`company_signal_atoms.signal_type`). */
export const COMPANY_SIGNAL_TYPES = [
  "hiring_growth",
  "leadership_change",
  "transformation_program",
  "international_expansion",
  "new_product_push",
  "restructuring",
  "cost_focus",
  "ai_initiative",
  "sustainability_push",
] as const;
export type CompanySignalType = (typeof COMPANY_SIGNAL_TYPES)[number];

const REQ_LABEL_NB: Partial<Record<OpportunityRequirementCategory, string>> = {
  leadership: "Kommersiell ledelse",
  saas: "SaaS-erfaring",
  enterprise_sales: "Enterprise-kunder",
  norwegian_language: "Norsk språk",
  transformation: "Transformasjon",
  remote_work: "Remote / hybrid",
  public_sector: "Offentlig sektor",
  finance: "Økonomi",
  operations: "Operasjonell skalering",
  startup: "Startup / tidlig fase",
  people_management: "Personal / ledelse av folk",
  technology: "Teknologi",
  strategy: "Strategi",
  sales: "Salg",
  security: "Sikkerhet",
  data: "Data / analyse",
  location: "Sted / reise",
  compensation: "Kompensasjon",
};

const PROFILE_LABEL_NB: Partial<Record<CompanyProfileCategory, string>> = {
  growth_company: "Vekstselskap",
  enterprise_company: "Storskala / enterprise",
  mission_driven: "Misjonsdrevet",
  sustainability_focus: "Bærekraftsfokus",
  flat_structure: "Flat struktur",
  global_company: "Global virksomhet",
  transformation_heavy: "Transformasjonsintensiv",
  engineering_culture: "Ingeniørkultur",
  high_autonomy: "Høy autonomi",
  process_heavy: "Prosess- og styringsorientert",
  matrix_organization: "Matriseorganisering",
  scaleup: "Scaleup",
  financial_stability: "Finansiell stabilitet (signal)",
  culture_strength: "Kultur (signal)",
};

const SIGNAL_LABEL_NB: Partial<Record<CompanySignalType, string>> = {
  hiring_growth: "Økt rekruttering / vekst",
  leadership_change: "Lederskifte / endring",
  transformation_program: "Transformasjonsprogram",
  international_expansion: "Internasjonal ekspansjon",
  new_product_push: "Nytt produkt / satsing",
  restructuring: "Omorganisering",
  cost_focus: "Kostnadsfokus",
  ai_initiative: "AI-satsing",
  sustainability_push: "Bærekraftssatsing",
};

export function opportunityRequirementLabelNb(cat: string): string {
  return REQ_LABEL_NB[cat as OpportunityRequirementCategory] ?? cat;
}

export function companyProfileLabelNb(cat: string): string {
  return PROFILE_LABEL_NB[cat as CompanyProfileCategory] ?? cat;
}

export function companySignalLabelNb(sig: string): string {
  return SIGNAL_LABEL_NB[sig as CompanySignalType] ?? sig;
}

export function normalizeAtomText(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»""]/g, "");
}

export function targetImportanceBand(score: number | null | undefined): MatchScoreBand | null {
  return matchScoreBand(score);
}
