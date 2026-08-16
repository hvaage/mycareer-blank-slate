// cv-ats-rules-no — Format-validator
// Sjekker filformat-relaterte regler: font, fontstørrelse, layout-attributter

import type { AtsViolation, CvDraft } from "../types.ts";

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

export const ATS_SAFE_FONTS: readonly string[] = [
  "Arial",
  "Calibri",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Verdana",
];

export const ATS_DEFAULT_FONT = "Calibri";
export const ATS_DEFAULT_FONT_SIZE_PT = 11;
export const ATS_MIN_FONT_SIZE_PT = 9;
export const ATS_MAX_FONT_SIZE_PT = 12;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateFormat(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Font-familie
  if (draft.font_family != null) {
    const isSafe = ATS_SAFE_FONTS.some(
      (f) => f.toLowerCase() === draft.font_family!.toLowerCase(),
    );
    if (!isSafe) {
      violations.push({
        severity: "error",
        category: "format",
        rule_id: "format.font_not_safe",
        message: `Fonten "${draft.font_family}" er ikke garantert ATS-vennlig.`,
        field_path: "font_family",
        suggestion: `Bruk én av: ${ATS_SAFE_FONTS.join(", ")}.`,
      });
    }
  }

  // Fontstørrelse
  if (draft.base_font_size_pt != null) {
    if (draft.base_font_size_pt < ATS_MIN_FONT_SIZE_PT) {
      violations.push({
        severity: "error",
        category: "format",
        rule_id: "format.font_too_small",
        message: `Fontstørrelse ${draft.base_font_size_pt}pt er for liten. ATS-er kan slite med å parse, og rekruttere kan ikke lese komfortabelt.`,
        field_path: "base_font_size_pt",
        suggestion: `Bruk minst ${ATS_MIN_FONT_SIZE_PT}pt, helst ${ATS_DEFAULT_FONT_SIZE_PT}pt.`,
      });
    } else if (draft.base_font_size_pt > ATS_MAX_FONT_SIZE_PT) {
      violations.push({
        severity: "warning",
        category: "format",
        rule_id: "format.font_too_large",
        message: `Fontstørrelse ${draft.base_font_size_pt}pt er stor for brødtekst og bruker mer plass.`,
        field_path: "base_font_size_pt",
        suggestion: `Vurder ${ATS_DEFAULT_FONT_SIZE_PT}pt for brødtekst.`,
      });
    }
  }

  return violations;
}
