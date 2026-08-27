/**
 * Karrierefase — aldersbasert livsfase, uavhengig av de 7 karrierestadiene.
 *
 * Fasen brukes kun som ekstra kontekst når nettverksaktiviteter foreslås.
 * Den påvirker ikke matchdimensjoner, scoring eller karrierestadiene.
 * Alder brukes aldri til å ekskludere brukeren fra forslag.
 */

export const CAREER_LIFE_PHASE_CODES = [
  "student_nyutdannet",
  "tidlig_karriere",
  "etablert_karriere",
  "senior_erfaren",
] as const;

export type CareerLifePhaseCode = (typeof CAREER_LIFE_PHASE_CODES)[number];

export type CareerLifePhaseDefinition = {
  code: CareerLifePhaseCode;
  labelNb: string;
  /** Veiledende aldersspenn, vist i valglisten. */
  ageRangeNb: string;
  /** Føring som legges inn i prompten for aktivitetsforslag. */
  suggestionGuidanceNb: string;
};

export const CAREER_LIFE_PHASES: readonly CareerLifePhaseDefinition[] = [
  {
    code: "student_nyutdannet",
    labelNb: "Student eller nyutdannet",
    ageRangeNb: "18–25",
    suggestionGuidanceNb:
      "Bygge første nettverk, faglige miljøer, alumni, hospitering, åpne henvendelser.",
  },
  {
    code: "tidlig_karriere",
    labelNb: "Tidlig i karrieren",
    ageRangeNb: "26–35",
    suggestionGuidanceNb:
      "Synlighet i fagmiljø, mentor, målrettede kaffeprater, første lederkontakter.",
  },
  {
    code: "etablert_karriere",
    labelNb: "Etablert karriere",
    ageRangeNb: "36–50",
    suggestionGuidanceNb:
      "Beslutningstakere og fagfeller på eget nivå, gjensidig verdi, styrking av eget omdømme.",
  },
  {
    code: "senior_erfaren",
    labelNb: "Senior / erfaren",
    ageRangeNb: "50+",
    suggestionGuidanceNb:
      "Tette relasjoner høyt i organisasjoner, styre-/rådgiverspor, aldersnøytral posisjonering med vekt på resultat og mandat.",
  },
] as const;

const PHASE_BY_CODE = Object.fromEntries(
  CAREER_LIFE_PHASES.map((p) => [p.code, p]),
) as Record<CareerLifePhaseCode, CareerLifePhaseDefinition>;

export function getCareerLifePhase(
  code: CareerLifePhaseCode | string | null | undefined,
): CareerLifePhaseDefinition | null {
  if (!code || !(code in PHASE_BY_CODE)) return null;
  return PHASE_BY_CODE[code as CareerLifePhaseCode];
}

export function isCareerLifePhaseCode(v: string): v is CareerLifePhaseCode {
  return (CAREER_LIFE_PHASE_CODES as readonly string[]).includes(v);
}

/**
 * Standardmapping fra år med erfaring til fase. Kun et forslag til brukeren —
 * verdien lagres aldri uten at brukeren selv bekrefter den.
 */
export function suggestCareerLifePhase(yearsExperience: number): CareerLifePhaseCode {
  const y = Number.isFinite(yearsExperience) ? yearsExperience : 0;
  if (y <= 3) return "student_nyutdannet";
  if (y <= 13) return "tidlig_karriere";
  if (y <= 28) return "etablert_karriere";
  return "senior_erfaren";
}
