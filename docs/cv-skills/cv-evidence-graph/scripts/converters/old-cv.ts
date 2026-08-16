// cv-evidence-graph — Converter: gammel CV (PDF eller DOCX) → atoms
// Stub-fil. Fylles ut når Modul 5 (gammel CV-import) implementeres.
//
// Forventet input: parset JSON fra Claude som har ekstrahert struktur fra CV-fil.
// Skjemaet er likt LinkedIn PDF, men med flere mulige seksjoner (volunteer, projects,
// publications, awards), siden brukerens egen CV kan være mer detaljert enn LinkedIn-export.

import type { AtomInsert } from "../types.ts";

export interface ParsedOldCv {
  name?: string;
  headline?: string;
  summary?: string;
  contact?: {
    email?: string;
    phone?: string;
    location?: string;
    linkedin_url?: string;
  };
  experience?: {
    company: string;
    title: string;
    location?: string;
    start?: string;
    end?: string;
    description?: string;
    bullets?: string[];
  }[];
  education?: {
    institution: string;
    degree: string;
    field?: string;
    start_year?: number;
    end_year?: number;
    thesis?: string;
    honors?: string;
  }[];
  skills?: string[];
  languages?: { name: string; level?: string }[];
  certifications?: {
    name: string;
    issuer: string;
    issued?: string;
  }[];
  volunteer?: {
    organization: string;
    role: string;
    start?: string;
    end?: string;
    description?: string;
  }[];
  projects?: {
    name: string;
    description: string;
    technologies?: string[];
    url?: string;
  }[];
}

/**
 * Konverter parset gammel CV til atoms.
 *
 * IKKE IMPLEMENTERT — stub. Fylles ut i Modul 5 (gammel CV-import).
 *
 * Implementasjons-notater:
 * - Brukerens egen CV kan ha både norsk og engelsk innhold blandet — Claude
 *   må parse begge til samme felt og caller fyller `content_no` eller `content_en`
 *   basert på språket detektert i hver tekstbit.
 * - Bullets kan være kort beskrivende ("Salgsleder for Norge og Sverige") eller
 *   prestasjonsorientert ("Vekst på 40% YoY"). Caller bør sortere disse til
 *   role.description vs achievement.
 * - Fra denne kilden får man typisk det rikeste datasettet — det er her vi
 *   forventer flest atoms per import.
 */
export function convertOldCv(
  parsed: ParsedOldCv,
  context: { user_id: string; import_id: string; source_format: "pdf" | "docx" },
): AtomInsert[] {
  // TODO: implementer i Modul 5
  throw new Error(
    "convertOldCv er ikke implementert ennå. Bygges i Modul 5 (gammel CV-import).",
  );
}
