export type RegionOption = { label: string; value: string | null };

export const REGIONS: RegionOption[] = [
  { label: "Hele Norge", value: null },
  { label: "Oslo", value: "03" },
  { label: "Akershus", value: "32" },
  { label: "Østfold", value: "31" },
  { label: "Buskerud", value: "33" },
  { label: "Innlandet", value: "34" },
  { label: "Vestfold", value: "39" },
  { label: "Telemark", value: "40" },
  { label: "Agder", value: "42" },
  { label: "Rogaland", value: "11" },
  { label: "Vestland", value: "46" },
  { label: "Møre og Romsdal", value: "15" },
  { label: "Trøndelag", value: "50" },
  { label: "Nordland", value: "18" },
  { label: "Troms", value: "55" },
  { label: "Finnmark", value: "56" },
];

/**
 * Strips technical suffixes from SSB region labels.
 * "Oslo - Oslove" -> "Oslo", "Trondheim - Tråante" -> "Trondheim".
 */
export function cleanRegionLabel(s: string | null | undefined): string {
  if (!s) return "";
  const i = s.indexOf(" - ");
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

export function regionLabelFromCode(code: string | null): string {
  return REGIONS.find((r) => r.value === code)?.label ?? "Hele Norge";
}
