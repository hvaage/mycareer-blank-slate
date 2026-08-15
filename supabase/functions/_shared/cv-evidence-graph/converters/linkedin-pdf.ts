// cv-evidence-graph — Converter: LinkedIn PDF (manuell eksport) → parsekandidater
// Stub-fil. Fylles ut når Modul 4 (LinkedIn PDF-import) implementeres.
//
// Forventet input: parset JSON fra Claude som har ekstrahert struktur fra PDF-en.
// Output: CandidateDraft[]
//
// Forskjell fra ZIP-import:
// - PDF-strukturen er mer flytende (ikke faste kolonner)
// - Achievement-bullets ofte mer komprimerte
// - Datoformatene mer varierte
// - Kvaliteten på output avhenger av Claude's PDF-parsing (Modul 4 håndterer)

import type { CandidateDraft } from "../types.ts";

export interface ParsedLinkedInPdf {
  name?: string;
  headline?: string;
  summary?: string;
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
  }[];
  skills?: string[];
  languages?: { name: string; level?: string }[];
  certifications?: {
    name: string;
    issuer: string;
    issued?: string;
    expires?: string;
  }[];
}

/**
 * Konverter parset LinkedIn PDF til parsekandidater.
 *
 * IKKE IMPLEMENTERT — stub. Fylles ut i Modul 4 (LinkedIn PDF-import).
 */
export function convertLinkedInPdf(
  parsed: ParsedLinkedInPdf,
  context: { user_id: string; import_id: string },
): CandidateDraft[] {
  // TODO: implementer i Modul 4
  throw new Error(
    "convertLinkedInPdf er ikke implementert ennå. Bygges i Modul 4 (LinkedIn PDF-import).",
  );
}
