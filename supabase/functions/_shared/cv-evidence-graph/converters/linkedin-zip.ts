// cv-evidence-graph — Converter: LinkedIn ZIP → atoms
// Stub-fil. Fylles ut når Modul 3 (LinkedIn ZIP-import) implementeres.
//
// Forventet input: parsede CSV-rader fra LinkedIn data export ZIP.
// LinkedIn-eksporten inneholder typisk:
//   Profile.csv         — headline, summary, industri
//   Positions.csv       — alle stillinger med beskrivelse
//   Education.csv       — utdanning
//   Skills.csv          — ferdigheter
//   Languages.csv       — språk
//   Certifications.csv  — sertifikater
//   Projects.csv        — prosjekter (om aktivert)
//
// Output: CandidateDraft[] klar til insertCandidates() etter validering.

import type { CandidateDraft } from "../types.ts";

// ---------------------------------------------------------------------------
// LinkedIn CSV-rad-typer
// ---------------------------------------------------------------------------

export interface LinkedInPositionRow {
  "Company Name"?: string;
  "Title"?: string;
  "Description"?: string;
  "Location"?: string;
  "Started On"?: string;       // f.eks. "Jan 2019" eller "2019"
  "Finished On"?: string;      // tom hvis pågående
}

export interface LinkedInEducationRow {
  "School Name"?: string;
  "Degree Name"?: string;
  "Notes"?: string;
  "Activities"?: string;
  "Start Date"?: string;
  "End Date"?: string;
}

export interface LinkedInSkillRow {
  "Name"?: string;
}

export interface LinkedInLanguageRow {
  "Name"?: string;
  "Proficiency"?: string;
}

export interface LinkedInCertificationRow {
  "Name"?: string;
  "Authority"?: string;
  "Started On"?: string;
  "Finished On"?: string;
  "License Number"?: string;
  "Url"?: string;
}

// ---------------------------------------------------------------------------
// Public API — implementeres i Modul 3
// ---------------------------------------------------------------------------

export interface LinkedInZipConversionResult {
  /** Flat liste med kandidater. Hierarkiet ligger i parent_local_ref. */
  candidates: CandidateDraft[];
  notes: string[];
}

/**
 * Konverter parsede LinkedIn ZIP-rader til parsekandidater.
 *
 * IKKE IMPLEMENTERT — stub. Fylles ut i Modul 3 (LinkedIn ZIP-import).
 *
 * Implementasjons-notater:
 * - Datoformat fra LinkedIn varierer ("Jan 2019", "2019", "2019-01"). Konverter til YYYY-MM.
 * - Description-feltet i Positions.csv inneholder ofte fritekst med linjeskift eller •.
 *   Splitt til separate achievement-kandidater basert på linjeskift, deretter sanere.
 * - Skills.csv inneholder kun navn. Bruk samme inferSkillCategory() som i profile-fields.ts,
 *   og sett suggested_from_category slik at korrigeringsraten kan måles.
 * - Languages.csv har "Proficiency" som ord ("Native or bilingual proficiency",
 *   "Professional working proficiency", etc.). Map til language.level-enum.
 * - Sett source_type='linkedin_zip', source_ref=import_id (fra cv_imports) og
 *   parse_confidence. Verken confidence eller attestation settes her — kandidater
 *   er ikke evidens før brukeren har bekreftet dem.
 */
export function convertLinkedInZip(
  parsed: {
    positions: LinkedInPositionRow[];
    educations: LinkedInEducationRow[];
    skills: LinkedInSkillRow[];
    languages: LinkedInLanguageRow[];
    certifications: LinkedInCertificationRow[];
  },
  context: { user_id: string; import_id: string },
): LinkedInZipConversionResult {
  // TODO: implementer i Modul 3
  throw new Error(
    "convertLinkedInZip er ikke implementert ennå. Bygges i Modul 3 (LinkedIn ZIP-import).",
  );
}
