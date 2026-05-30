// @ts-nocheck
/**
 * Career stage model — default priorities and UI hints for adaptive matching (MVP).
 * Full weighting integration into scores comes in a later module.
 */

import type { MatchDimensionId } from "@/lib/career-match-dimensions";

export const CAREER_STAGE_IDS = [
  "student",
  "early_career",
  "mid_career",
  "senior_specialist",
  "senior_leader",
  "executive",
  "founder",
] as const;

export type CareerStageId = (typeof CAREER_STAGE_IDS)[number];

export type CareerStageDefinition = {
  id: CareerStageId;
  labelNb: string;
  descriptionNb: string;
  /** Ordered dimension ids — earlier = higher default emphasis in future engines */
  defaultPriorityOrder: readonly MatchDimensionId[];
  weightingHintsNb: readonly string[];
  uiHints: {
    emphasizeLeadership: boolean;
    emphasizeLearning: boolean;
    /** Prefer shorter forms / fewer leadership fields in first-time UX */
    compactMotivationSection: boolean;
  };
};

export const CAREER_STAGES: readonly CareerStageDefinition[] = [
  {
    id: "student",
    labelNb: "Student",
    descriptionNb: "Bygger kompetanse og nettverk før første fulltidsrolle.",
    defaultPriorityOrder: [
      "growth_match",
      "qualification_match",
      "culture_match",
      "network_advantage",
      "flexibility_match",
      "mission_match",
      "industry_match",
      "compensation_match",
      "leadership_match",
      "strategic_value",
    ],
    weightingHintsNb: [
      "Læring og vekst veies høyere enn kompensasjon.",
      "Mentorordninger og tydelig fagmiljø er viktig.",
    ],
    uiHints: {
      emphasizeLeadership: false,
      emphasizeLearning: true,
      compactMotivationSection: true,
    },
  },
  {
    id: "early_career",
    labelNb: "Tidlig i karrieren",
    descriptionNb: "Noen års erfaring; ønsker ofte bredde og tydelig utvikling.",
    defaultPriorityOrder: [
      "growth_match",
      "qualification_match",
      "culture_match",
      "mission_match",
      "flexibility_match",
      "industry_match",
      "compensation_match",
      "leadership_match",
      "strategic_value",
      "network_advantage",
    ],
    weightingHintsNb: [
      "Balansert vekt på læring og kultur.",
      "Ledelsesambisjon kan være sekundær.",
    ],
    uiHints: {
      emphasizeLeadership: false,
      emphasizeLearning: true,
      compactMotivationSection: false,
    },
  },
  {
    id: "mid_career",
    labelNb: "Midtkarriere",
    descriptionNb: "Etablert fagperson; ofte balanse mellom dybde, komp og livsstil.",
    defaultPriorityOrder: [
      "qualification_match",
      "culture_match",
      "compensation_match",
      "growth_match",
      "flexibility_match",
      "strategic_value",
      "mission_match",
      "industry_match",
      "leadership_match",
      "network_advantage",
    ],
    weightingHintsNb: [
      "Kompensasjon og strategisk CV-verdi får mer vekt.",
      "Fleksibilitet blir ofte viktigere.",
    ],
    uiHints: {
      emphasizeLeadership: false,
      emphasizeLearning: false,
      compactMotivationSection: false,
    },
  },
  {
    id: "senior_specialist",
    labelNb: "Senior spesialist",
    descriptionNb: "Dyp ekspertise; ønsker ofte autonomi og teknisk/strategisk innflytelse.",
    defaultPriorityOrder: [
      "qualification_match",
      "strategic_value",
      "culture_match",
      "growth_match",
      "flexibility_match",
      "mission_match",
      "compensation_match",
      "industry_match",
      "leadership_match",
      "network_advantage",
    ],
    weightingHintsNb: [
      "Fagdybde og mandat veies høyere enn tradisjonell lederløype.",
      "Strategisk verdi for egen profil er sentralt.",
    ],
    uiHints: {
      emphasizeLeadership: false,
      emphasizeLearning: false,
      compactMotivationSection: false,
    },
  },
  {
    id: "senior_leader",
    labelNb: "Senior leder",
    descriptionNb: "Leder team eller domener; mandat, kultur og leveranse.",
    defaultPriorityOrder: [
      "leadership_match",
      "culture_match",
      "strategic_value",
      "mission_match",
      "compensation_match",
      "qualification_match",
      "growth_match",
      "industry_match",
      "flexibility_match",
      "network_advantage",
    ],
    weightingHintsNb: [
      "Lederskap, kultur og strategisk påvirkning veies opp.",
      "Eierskap til resultater og organisasjonsform blir viktig.",
    ],
    uiHints: {
      emphasizeLeadership: true,
      emphasizeLearning: false,
      compactMotivationSection: false,
    },
  },
  {
    id: "executive",
    labelNb: "Ledelse (executive)",
    descriptionNb: "Toppledelse eller nær topp; mandat, eierskap og strategi.",
    defaultPriorityOrder: [
      "leadership_match",
      "strategic_value",
      "mission_match",
      "culture_match",
      "compensation_match",
      "industry_match",
      "network_advantage",
      "qualification_match",
      "growth_match",
      "flexibility_match",
    ],
    weightingHintsNb: [
      "Ledelse, mandat og strategisk innflytelse veies høyest.",
      "Kompensasjon og eierskap ofte sentralt.",
    ],
    uiHints: {
      emphasizeLeadership: true,
      emphasizeLearning: false,
      compactMotivationSection: false,
    },
  },
  {
    id: "founder",
    labelNb: "Gründer / founder",
    descriptionNb: "Bygger produkt og organisasjon; risiko, eierskap og tempo.",
    defaultPriorityOrder: [
      "strategic_value",
      "mission_match",
      "growth_match",
      "compensation_match",
      "culture_match",
      "network_advantage",
      "industry_match",
      "leadership_match",
      "qualification_match",
      "flexibility_match",
    ],
    weightingHintsNb: [
      "Strategisk verdi, misjon og vekst veies opp mot risiko.",
      "Nettverk og fleksibilitet kan variere sterkt.",
    ],
    uiHints: {
      emphasizeLeadership: true,
      emphasizeLearning: true,
      compactMotivationSection: false,
    },
  },
] as const;

const STAGE_BY_ID = Object.fromEntries(CAREER_STAGES.map((s) => [s.id, s])) as Record<
  CareerStageId,
  CareerStageDefinition
>;

export function getCareerStage(id: CareerStageId | string | null | undefined): CareerStageDefinition | null {
  if (!id || !(id in STAGE_BY_ID)) return null;
  return STAGE_BY_ID[id as CareerStageId];
}

export function isCareerStageId(v: string): v is CareerStageId {
  return (CAREER_STAGE_IDS as readonly string[]).includes(v);
}
