/**
 * Aldersgrupper — samme intervaller som lønnsstatistikken i Markedsinnsikt bruker.
 *
 * Feltet er frivillig og brukes kun til lønnssammenligning og som kontekst.
 * Alder brukes aldri til å ekskludere brukeren fra stillinger eller forslag.
 */

import type { CareerLifePhaseCode } from "@/lib/career-life-phase";

export const AGE_GROUP_CODES = [
  "00-24",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-49",
  "50-54",
  "55-59",
  "60-",
] as const;

export type AgeGroupCode = (typeof AGE_GROUP_CODES)[number];

export type AgeGroupDefinition = {
  code: AgeGroupCode;
  labelNb: string;
};

export const AGE_GROUPS: readonly AgeGroupDefinition[] = [
  { code: "00-24", labelNb: "Under 25 år" },
  { code: "25-29", labelNb: "25–29 år" },
  { code: "30-34", labelNb: "30–34 år" },
  { code: "35-39", labelNb: "35–39 år" },
  { code: "40-44", labelNb: "40–44 år" },
  { code: "45-49", labelNb: "45–49 år" },
  { code: "50-54", labelNb: "50–54 år" },
  { code: "55-59", labelNb: "55–59 år" },
  { code: "60-", labelNb: "60 år og over" },
] as const;

const BY_CODE = Object.fromEntries(AGE_GROUPS.map((a) => [a.code, a])) as Record<
  AgeGroupCode,
  AgeGroupDefinition
>;

export function getAgeGroup(code: string | null | undefined): AgeGroupDefinition | null {
  if (!code || !(code in BY_CODE)) return null;
  return BY_CODE[code as AgeGroupCode];
}

export function isAgeGroupCode(v: string): v is AgeGroupCode {
  return (AGE_GROUP_CODES as readonly string[]).includes(v);
}

/**
 * Forslag til karrierefase ut fra aldersgruppe. Kun et forslag — verdien
 * lagres aldri uten at brukeren selv trykker «Bruk forslag», og en fase
 * brukeren allerede har valgt blir aldri overskrevet.
 */
export function suggestLifePhaseFromAgeGroup(code: string | null | undefined): CareerLifePhaseCode | null {
  switch (code) {
    case "00-24":
      return "student_nyutdannet";
    case "25-29":
    case "30-34":
      return "tidlig_karriere";
    case "35-39":
    case "40-44":
    case "45-49":
      return "etablert_karriere";
    case "50-54":
    case "55-59":
    case "60-":
      return "senior_erfaren";
    default:
      return null;
  }
}
