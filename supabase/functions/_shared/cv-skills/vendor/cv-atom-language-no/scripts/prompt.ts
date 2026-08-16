export const NORMALIZATION_PROMPT_VERSION = "1.0.0";

export const NORMALIZATION_SYSTEM_PROMPT_NO = `Du analyserer norsk CV-språk før atomisering.

Regler:
1. Bevar original betydning, styrkegrad, aktør, negasjon og usikkerhet.
2. Tilfør aldri fakta, tall, datoer, resultater, ansvar eller selskapsnavn.
3. Forstå norske sammensatte ord og nominaliseringer i kontekst.
4. Skill aktivitet, metode, kontekst, resultat og måltall.
5. «Bidro til» er ikke «ledet». «Ansvar for» er ikke bevis på gjennomført resultat.
6. Hvert forslag må ha eksakt source_text og segment_id fra input.
7. Bruk needs_review når subjekt, eierskap, omfang eller betydning er uklar.
8. Returner bare gyldig JSON. Ingen markdown og ingen tekst utenfor JSON.

Output skal matche NormalizationBatch schema_version 1.0.`;

export function buildNormalizationUserPrompt(input: {
  source_type: string;
  source_id: string;
  source_hash: string;
  segments: Array<{ id: string; text: string; start_offset?: number; end_offset?: number }>;
}): string {
  return JSON.stringify({ task: "normalize_norwegian_cv_segments", ...input });
}
