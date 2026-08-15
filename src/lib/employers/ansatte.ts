/**
 * Ansattetall fra Brreg har tre tilstander, ikke to.
 *
 * Brreg oppgir ikke ansattetall for enheter med null til fire ansatte, og
 * `har_registrert_antall_ansatte = false` betyr at vi ikke vet. 63 prosent av
 * speilet er ukjent. Vises "0" eller "—" der tallet er ukjent, påstår verktøyet
 * at selskapet ikke har ansatte når vi faktisk ikke vet det.
 *
 * Derfor: tre kategorier, alltid vist sammen der ansatte aggregeres.
 */

export type AnsatteKategori = "fem_eller_flere" | "null_til_fire" | "ukjent";

export const ANSATTE_KATEGORI_REKKEFOELGE: AnsatteKategori[] = [
  "fem_eller_flere",
  "null_til_fire",
  "ukjent",
];

export const ANSATTE_KATEGORI_LABEL: Record<AnsatteKategori, string> = {
  fem_eller_flere: "Fem eller flere",
  null_til_fire: "Null til fire",
  ukjent: "Ukjent",
};

export const ANSATTE_KILDEFORKLARING =
  "Brreg oppgir ikke ansattetall for enheter med null til fire ansatte. «Ukjent» betyr at registeret ikke har tallet — ikke at selskapet er uten ansatte.";

type AnsatteFelt = {
  antall_ansatte?: number | null;
  har_registrert_antall_ansatte?: boolean | null;
};

export function ansatteKategori(row: AnsatteFelt): AnsatteKategori {
  if (typeof row.antall_ansatte === "number" && row.antall_ansatte > 0) {
    return "fem_eller_flere";
  }
  if (row.har_registrert_antall_ansatte === true) return "null_til_fire";
  return "ukjent";
}

/** Visningsverdi for én rad. Aldri «0» eller «—» når tallet er ukjent. */
export function formatAnsatte(row: AnsatteFelt): string {
  const kat = ansatteKategori(row);
  if (kat === "fem_eller_flere") {
    return new Intl.NumberFormat("nb-NO").format(row.antall_ansatte as number);
  }
  if (kat === "null_til_fire") return "0–4";
  return "Ukjent";
}

/** true når tallet ikke er et faktisk antall og bør dempes visuelt. */
export function ansatteErUkjent(row: AnsatteFelt): boolean {
  return ansatteKategori(row) === "ukjent";
}

export type AnsatteFordeling = {
  fem_eller_flere: number;
  null_til_fire: number;
  ukjent: number;
  total: number;
  capped: boolean;
};

export function fordelingFraRader(rows: ReadonlyArray<AnsatteFelt>): AnsatteFordeling {
  const f: AnsatteFordeling = {
    fem_eller_flere: 0,
    null_til_fire: 0,
    ukjent: 0,
    total: rows.length,
    capped: false,
  };
  for (const r of rows) f[ansatteKategori(r)] += 1;
  return f;
}

export function fmtAntall(n: number): string {
  return new Intl.NumberFormat("nb-NO").format(n);
}
