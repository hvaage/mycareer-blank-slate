// @ts-nocheck
/**
 * Shared match dimensions for future Career Intelligence scoring (1–6 scale).
 * Decoupled from employer_analysis_jobs and Careerjet — consumed later by adaptive engines.
 */

export const MATCH_SCORE_MIN = 1;
export const MATCH_SCORE_MAX = 6;

export const MATCH_DIMENSION_IDS = [
  "qualification_match",
  "culture_match",
  "leadership_match",
  "industry_match",
  "mission_match",
  "growth_match",
  "compensation_match",
  "flexibility_match",
  "strategic_value",
  "network_advantage",
] as const;

export type MatchDimensionId = (typeof MATCH_DIMENSION_IDS)[number];

export type MatchScoreBand = "weak" | "moderate" | "strong";

export type MatchDimensionDefinition = {
  id: MatchDimensionId;
  labelNb: string;
  shortLabelNb: string;
  descriptionNb: string;
  /** How this dimension may feed future engines (CV, LinkedIn, apply decision, etc.) */
  futureUseNb: string;
};

export const CAREER_MATCH_DIMENSIONS: readonly MatchDimensionDefinition[] = [
  {
    id: "qualification_match",
    labelNb: "Kvalifikasjon og erfaring",
    shortLabelNb: "Kvalifikasjon",
    descriptionNb: "Hvor godt dine ferdigheter og erfaring treffer rollen og kravene.",
    futureUseNb: "CV-tilpasning, søknadstekst og «bør jeg søke?».",
  },
  {
    id: "culture_match",
    labelNb: "Kultur og arbeidsmåte",
    shortLabelNb: "Kultur",
    descriptionNb: "Passform mot verdier, samarbeidsstil og miljø.",
    futureUseNb: "Arbeidsgivervalg, intervjuforberedelse og nettverksstrategi.",
  },
  {
    id: "leadership_match",
    labelNb: "Ledelse og mandat",
    shortLabelNb: "Ledelse",
    descriptionNb: "Treff på ledelsesnivå, ansvar og beslutningsrom.",
    futureUseNb: "LinkedIn-profil, stillingstekster og lønnsforhandling.",
  },
  {
    id: "industry_match",
    labelNb: "Bransje og domene",
    shortLabelNb: "Bransje",
    descriptionNb: "Relevans av bransje, produkt og markedskontekst.",
    futureUseNb: "Jobbfiltre og «hvordan skille deg ut» i bransjen.",
  },
  {
    id: "mission_match",
    labelNb: "Formål og misjon",
    shortLabelNb: "Misjon",
    descriptionNb: "Hvor sterkt selskapets retning treffer det du bryr deg om.",
    futureUseNb: "Søknadsargumenter og langsiktig karrierevalg.",
  },
  {
    id: "growth_match",
    labelNb: "Læring og vekst",
    shortLabelNb: "Vekst",
    descriptionNb: "Mulighet for utvikling, mentorskap og nye oppgaver.",
    futureUseNb: "Utviklingsplan og intervjuspørsmål om vekst.",
  },
  {
    id: "compensation_match",
    labelNb: "Kompensasjon og rammer",
    shortLabelNb: "Kompensasjon",
    descriptionNb: "Lønn, bonus, eierskap og økonomisk risiko vs forventning.",
    futureUseNb: "Tilbudsvurdering og forhandlingsstrategi.",
  },
  {
    id: "flexibility_match",
    labelNb: "Fleksibilitet",
    shortLabelNb: "Fleksibilitet",
    descriptionNb: "Remote, tid, reise og livsstil vs dine preferanser.",
    futureUseNb: "Stillingsfilter og arbeidslivsbalanse.",
  },
  {
    id: "strategic_value",
    labelNb: "Strategisk verdi for deg",
    shortLabelNb: "Strategisk verdi",
    descriptionNb: "Hvor mye rollen styrker CV, merkevare og neste steg.",
    futureUseNb: "«Bør jeg søke?» og langsiktig posisjonering.",
  },
  {
    id: "network_advantage",
    labelNb: "Nettverk og synlighet",
    shortLabelNb: "Nettverk",
    descriptionNb: "Mulighet til å bygge kontakter og synlighet i feltet.",
    futureUseNb: "LinkedIn og nettverksstrategi.",
  },
] as const;

const DIMENSION_BY_ID: Record<MatchDimensionId, MatchDimensionDefinition> = Object.fromEntries(
  CAREER_MATCH_DIMENSIONS.map((d) => [d.id, d]),
) as Record<MatchDimensionId, MatchDimensionDefinition>;

export function getMatchDimension(id: MatchDimensionId): MatchDimensionDefinition {
  return DIMENSION_BY_ID[id];
}

/** 1–2 weak, 3–4 moderate, 5–6 strong (MVP bands for UI and future explainability). */
export function matchScoreBand(score: number | null | undefined): MatchScoreBand | null {
  if (score == null || Number.isNaN(score)) return null;
  const s = Math.round(Number(score));
  if (s < MATCH_SCORE_MIN || s > MATCH_SCORE_MAX) return null;
  if (s <= 2) return "weak";
  if (s <= 4) return "moderate";
  return "strong";
}

export function matchScoreBandLabelNb(band: MatchScoreBand): string {
  switch (band) {
    case "weak":
      return "Svak";
    case "moderate":
      return "Moderat";
    case "strong":
      return "Sterk";
  }
}

export function clampMatchScore(n: number): number {
  return Math.min(MATCH_SCORE_MAX, Math.max(MATCH_SCORE_MIN, Math.round(n)));
}
