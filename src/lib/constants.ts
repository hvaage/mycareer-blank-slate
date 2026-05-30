export const STATUS_LABELS: Record<string, string> = {
  identifisert: "Identifisert",
  søknad_generert: "Søknad generert",
  søknad_sendt: "Søknad sendt",
  screening: "Screening",
  intervju_1: "Intervju 1",
  intervju_2: "Intervju 2",
  intervju_3: "Intervju 3",
  intervju_4: "Intervju 4",
  case_study: "Case study",
  candidate_profiling: "Kandidatprofilering",
  tilbud_mottatt: "Tilbud mottatt",
  avsluttet: "Avsluttet",
  trukket: "Trukket",
};

export const STATUS_ORDER = [
  "identifisert",
  "søknad_generert",
  "søknad_sendt",
  "screening",
  "intervju_1",
  "intervju_2",
  "intervju_3",
  "intervju_4",
  "case_study",
  "candidate_profiling",
  "tilbud_mottatt",
  "avsluttet",
  "trukket",
] as const;

export const STATUS_BADGE_CLASS: Record<string, string> = {
  identifisert: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  søknad_generert: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  søknad_sendt: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  screening: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  intervju_1: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  intervju_2: "bg-indigo-200 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  intervju_3: "bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  intervju_4: "bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  case_study: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  candidate_profiling: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  tilbud_mottatt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  avsluttet: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  trukket: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export const PRIORITY_LABELS: Record<string, string> = {
  høy: "Høy",
  middels: "Middels",
  lav: "Lav",
};
export const PRIORITY_BADGE_CLASS: Record<string, string> = {
  høy: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  middels: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  lav: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export const SENTIMENT_LABELS: Record<string, string> = {
  positiv: "Positiv",
  nøytral: "Nøytral",
  negativ: "Negativ",
  usikker: "Usikker",
};
export const SENTIMENT_BADGE_CLASS: Record<string, string> = {
  positiv: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  nøytral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  negativ: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  usikker: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export const STAGE_TYPE_LABELS: Record<string, string> = {
  screening: "Screening",
  intervju_1: "Intervju 1",
  intervju_2: "Intervju 2",
  intervju_3: "Intervju 3",
  intervju_4: "Intervju 4",
  case_study: "Case study",
  candidate_profiling: "Kandidatprofilering",
};

export const STAGE_STATUS_LABELS: Record<string, string> = {
  planlagt: "Planlagt",
  gjennomført: "Gjennomført",
  avbrutt: "Avbrutt",
  avventet: "Avventet",
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  cv: "CV",
  søknadsbrev: "Søknadsbrev",
  case_dokument: "Case-dokument",
  referanseliste: "Referanseliste",
  annet: "Annet",
};

export const URGENCY_BADGE_CLASS: Record<string, string> = {
  kritisk: "bg-red-500",
  høy: "bg-orange-500",
  middels: "bg-yellow-500",
  lav: "bg-green-500",
  ingen: "bg-slate-300",
};
