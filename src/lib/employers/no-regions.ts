// Dagens norske fylkesnummer (per 2024-reform).
// Backend kan returnere historiske/særkoder; UI behandler dem passivt.
export type Fylke = { nummer: string; navn: string };

export const FYLKER: ReadonlyArray<Fylke> = [
  { nummer: "03", navn: "Oslo" },
  { nummer: "11", navn: "Rogaland" },
  { nummer: "15", navn: "Møre og Romsdal" },
  { nummer: "18", navn: "Nordland" },
  { nummer: "31", navn: "Østfold" },
  { nummer: "32", navn: "Akershus" },
  { nummer: "33", navn: "Buskerud" },
  { nummer: "34", navn: "Innlandet" },
  { nummer: "39", navn: "Vestfold" },
  { nummer: "40", navn: "Telemark" },
  { nummer: "42", navn: "Agder" },
  { nummer: "46", navn: "Vestland" },
  { nummer: "50", navn: "Trøndelag" },
  { nummer: "55", navn: "Troms" },
  { nummer: "56", navn: "Finnmark" },
];

export function fylkesnavn(nummer: string | null | undefined): string | null {
  if (!nummer) return null;
  return FYLKER.find((f) => f.nummer === nummer)?.navn ?? null;
}

export const ARBEIDSGIVER_TYPER = [
  { value: "privat", label: "Privat" },
  { value: "statlig", label: "Statlig" },
  { value: "kommunal_fylkeskommunal", label: "Kommunal/fylkeskommunal" },
  { value: "offentlig", label: "Offentlig (annet)" },
  { value: "ideell_stiftelse", label: "Ideell/stiftelse" },
] as const;

export type ArbeidsgiverType = (typeof ARBEIDSGIVER_TYPER)[number]["value"];
