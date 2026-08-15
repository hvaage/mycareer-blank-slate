/**
 * Settes til true FØRST når et driftsvarsel er bekreftet mottatt i innboksen
 * av et menneske. Utsending uten bekreftet mottak teller ikke som verifisert.
 */
export const DRIFTSVARSLING_VERIFISERT = false;

export const DRIFT_KILDER: Array<{ key: string; navn: string; intervall: string; varsler: string }> = [
  { key: "brreg_enheter", navn: "Enhetsimport (BRREG fullfil)", intervall: "14 dager", varsler: "16 dager" },
  { key: "regnskap", navn: "regnskap-sync-15min", intervall: "15 minutter", varsler: "60 minutter" },
  { key: "nav", navn: "NAV-synk", intervall: "30 minutter", varsler: "90 minutter" },
  { key: "careerjet", navn: "Careerjet-synk", intervall: "6 timer", varsler: "12 timer" },
  { key: "watchdog", navn: "Vaktjobben selv (hjerteslag)", intervall: "1 time", varsler: "3 timer" },
];
