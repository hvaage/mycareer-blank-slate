/** Suggested chips for MVP UI — users can combine freely; stored as text[] in DB. */

export const SUGGESTED_ROLE_TYPES = [
  "Utvikling / tech",
  "Produkt",
  "Prosjektledelse",
  "Salg",
  "Markedsføring",
  "HR / People",
  "Finans",
  "Operasjoner",
  "Konsulent",
  "Forskning",
  "Design / UX",
  "Jus",
  "Annet",
] as const;

export const SUGGESTED_COMPANY_SIZES = [
  "1–10",
  "11–50",
  "51–200",
  "201–1000",
  "1000+",
  "Ubetydelig — kultur viktigere",
] as const;

export const SUGGESTED_WORK_STYLES = [
  "Remote-first",
  "Hybrid",
  "Kontor",
  "Mye reising OK",
  "Lite reising",
  "Asynkront samarbeid",
  "Høyt tempo",
  "Forutsigbar hverdag",
] as const;

export const REMOTE_PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "remote_first", label: "Helst hjemmekontor / remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "office_ok", label: "Kontor er greit" },
  { value: "no_pref", label: "Ingen sterk preferanse" },
];

export const TRAVEL_PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Lite reise" },
  { value: "medium", label: "Moderat reise" },
  { value: "high", label: "Mye reise er OK" },
  { value: "no_pref", label: "Ingen sterk preferanse" },
];

export const LEADERSHIP_LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: "individual", label: "Individbidrager" },
  { value: "senior_ic", label: "Senior IC / tech lead" },
  { value: "manager", label: "Leder (team)" },
  { value: "director", label: "Director / avdeling" },
  { value: "vp", label: "VP / C-level" },
  { value: "founder", label: "Gründer / eier" },
];
