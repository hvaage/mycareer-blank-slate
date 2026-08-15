/**
 * Navneleksikon — smalt, bevisst kort.
 *
 * Formålet er ikke å klassifisere alt, men å gi et *forhåndsvalg* på de
 * navnene der typen er åpenbar, slik at gjennomgangen ikke blir tjue like
 * spørsmål på rad. Leksikonet overstyrer ingenting: det setter
 * `suggested_atom_type`, mens brukerens valg lagres i `resolved_atom_type`.
 *
 * Utvid listen når treffsikkerheten er målt. Alt som ikke står her blir
 * et spørsmål, som før.
 */

import type { AtomType, ParserSkillCategory } from "./types.ts";

export interface NameSuggestion {
  atom_type: AtomType;
  category: ParserSkillCategory;
  /** Sikkerhet i forslaget, ikke i påstanden. */
  parse_confidence: number;
  /** Kanonisk skrivemåte, brukt til visning. */
  canonical: string;
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "");
}

/** Kjente instrumenter (verktøy og systemer). Navn -> kanonisk skrivemåte. */
const KNOWN_TOOLS: Record<string, string> = {
  "salesforce": "Salesforce",
  "excel": "Excel",
  "microsoft excel": "Excel",
  "powerpoint": "PowerPoint",
  "microsoft powerpoint": "PowerPoint",
  "word": "Word",
  "power bi": "Power BI",
  "powerbi": "Power BI",
  "tableau": "Tableau",
  "sap": "SAP",
  "jira": "Jira",
  "confluence": "Confluence",
  "hubspot": "HubSpot",
  "photoshop": "Photoshop",
  "adobe photoshop": "Photoshop",
  "illustrator": "Illustrator",
  "indesign": "InDesign",
  "figma": "Figma",
  "sketch": "Sketch",
  "slack": "Slack",
  "notion": "Notion",
  "asana": "Asana",
  "trello": "Trello",
  "miro": "Miro",
  "visma": "Visma",
  "tripletex": "Tripletex",
  "servicenow": "ServiceNow",
  "dynamics 365": "Dynamics 365",
  "microsoft dynamics": "Dynamics 365",
  "google analytics": "Google Analytics",
  "sql": "SQL",
  "git": "Git",
  "docker": "Docker",
  "kubernetes": "Kubernetes",
  "aws": "AWS",
  "azure": "Azure",
};

/** Kjente språk. Språk er kvalifikasjon, ikke kompetanse. */
const KNOWN_LANGUAGES: Record<string, string> = {
  "norsk": "Norsk",
  "norwegian": "Norsk",
  "bokmål": "Norsk",
  "nynorsk": "Nynorsk",
  "engelsk": "Engelsk",
  "english": "Engelsk",
  "svensk": "Svensk",
  "swedish": "Svensk",
  "dansk": "Dansk",
  "danish": "Dansk",
  "tysk": "Tysk",
  "german": "Tysk",
  "fransk": "Fransk",
  "french": "Fransk",
  "spansk": "Spansk",
  "spanish": "Spansk",
  "italiensk": "Italiensk",
  "portugisisk": "Portugisisk",
  "polsk": "Polsk",
  "russisk": "Russisk",
  "arabisk": "Arabisk",
  "kinesisk": "Kinesisk",
  "mandarin": "Kinesisk (mandarin)",
  "japansk": "Japansk",
};

/**
 * Slår opp et navn i leksikonet. `null` betyr «vet ikke» — da blir det
 * et spørsmål til brukeren.
 */
export function lookupNameSuggestion(rawName: string): NameSuggestion | null {
  const key = norm(rawName);
  if (!key) return null;

  const tool = KNOWN_TOOLS[key];
  if (tool) {
    return { atom_type: "tool", category: "tool", parse_confidence: 0.85, canonical: tool };
  }
  const language = KNOWN_LANGUAGES[key];
  if (language) {
    return {
      atom_type: "language",
      category: "language",
      parse_confidence: 0.85,
      canonical: language,
    };
  }
  return null;
}

/** Antall navn leksikonet dekker. Brukes i tester og rapportering. */
export const NAME_LEXICON_SIZE =
  Object.keys(KNOWN_TOOLS).length + Object.keys(KNOWN_LANGUAGES).length;
