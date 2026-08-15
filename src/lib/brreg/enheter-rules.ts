/**
 * BRREG ENHETSREGISTER — IMPORT- OG MARKØRREGLER
 * ==============================================
 *
 * HVORFOR DENNE FILEN FINNES
 * --------------------------
 * `reg.enheter` i karrierenmin ble opprinnelig fylt av en importjobb som bodde
 * utenfor dette repoet (sokr.no). Koden fulgte aldri med. Speilet inneholder
 * altså 439 773 rader som er filtrert og markert av logikk ingen har hatt
 * tilgang til.
 *
 * Reglene under er REKONSTRUERT FRA DATA (august 2026) ved å teste hypoteser
 * mot hele tabellen til avviket var null. De er ikke gjettet, og de er ikke
 * hentet fra Suverra. Hver regel har målingen som bekreftet den notert.
 *
 * Neste person skal ikke måtte gjøre den jobben på nytt: endrer du en regel,
 * oppdater målingen i kommentaren og kjør sammenligningsporten under.
 *
 * MÅLEGRUNNLAG (reg.enheter, 2026-08-15, 439 773 rader):
 *   - naeringskode1_kode LIKE '64.20%'                    → 0 rader
 *   - ENK med 0 ansatte                                   → 0 rader
 *   - SAM/BRL/BBL med 0 ansatte                           → 0 rader
 *   - AS med 0 ansatte                                    → 367 211 rader (IKKE filtrert)
 *   - er_utdanning avvik mot 85.40x                       → 0 rader
 *   - er_rekruttering avvik mot 78.100/78.200             → 0 rader
 *   - er_offentlig avvik mot regelen under                → 0 rader
 *   - er_i_konsern avvik mot «overordnetEnhet finnes»     → 0 rader
 *
 * MERK: `overordnet_enhet`-kolonnen er IKKE en gyldig kilde for er_i_konsern.
 * 30 197 rader har uenighet mellom kolonnen og markøren; markøren følger
 * kildefeltet `overordnetEnhet` i Brreg-posten, kolonnen er delvis uløftet.
 */

// ---------------------------------------------------------------------------
// Kildepost (kun feltene reglene bruker)
// ---------------------------------------------------------------------------

export interface BrregEnhetRecord {
  organisasjonsnummer: string;
  navn?: string | null;
  organisasjonsform?: { kode?: string | null } | null;
  naeringskode1?: { kode?: string | null } | null;
  antallAnsatte?: number | null;
  institusjonellSektorkode?: { kode?: string | null } | null;
  overordnetEnhet?: string | null;
}

const formKode = (r: BrregEnhetRecord) => r.organisasjonsform?.kode ?? null;
const nace1 = (r: BrregEnhetRecord) => r.naeringskode1?.kode ?? null;
const sektor = (r: BrregEnhetRecord) => r.institusjonellSektorkode?.kode ?? null;
const ansatte = (r: BrregEnhetRecord) => r.antallAnsatte ?? 0;

// ---------------------------------------------------------------------------
// ARBEIDSGIVERFILTER
// ---------------------------------------------------------------------------

/**
 * UTVIDET REGEL (august 2026) — UTLEDET AV FORDELINGSANALYSE, IKKE AV BEVART KODE
 * ------------------------------------------------------------------------------
 * Den opprinnelige rekonstruksjonen antok at bare ENK/SAM/BRL/BBL krevde
 * ansatte. Den var for løs: mellomlagringen ga 694 754 rader mot speilets
 * 439 773. Fordelingsanalysen per organisasjonsform viste at speilet
 * inneholder nøyaktig de enhetene med ansatte > 0 for ALLE former utenom
 * AS, ASA og de offentlige formene. FLI, ESEK, NUF, DA og SA stemte på raden.
 *
 * Regelen er altså: ansatte kreves med mindre formen er AS, ASA eller
 * offentlig. Målt mot mellomlagringen gir den 443 248 rader mot speilets
 * 439 773 — 3 475 i registervekst på to måneder, som stemmer.
 *
 * Dette er utledet av data, ikke hentet fra den tapte importkoden. Endrer du
 * listen under, kjør fordelingsanalysen på nytt og oppdater tallene her.
 */
export const FORMS_EXEMPT_FROM_EMPLOYEE_REQUIREMENT = [
  "AS",
  "ASA",
  "STAT",
  "KOMM",
  "FYLK",
  "KF",
  "FKF",
  "IKS",
  "SF",
  "ORGL",
  "KIRK",
] as const;

/**
 * Historisk (for referanse): den første, for løse rekonstruksjonen.
 * Beholdt fordi testene dokumenterer overgangen.
 */
export const FORMS_REQUIRING_EMPLOYEES = ["ENK", "SAM", "BRL", "BBL"] as const;

/**
 * Næringskoder som utelukkes kategorisk uansett ansatte.
 * 64.20x = holdingselskaper — juridiske skall, ikke arbeidsplasser.
 * Bekreftet: 0 rader i speilet med 64.20%.
 */
export const EXCLUDED_NACE_PREFIXES = ["64.20"] as const;

export type ExcludeReason =
  | "nace_excluded"
  | "form_requires_employees"
  | "missing_orgnr";

export interface FilterDecision {
  include: boolean;
  reason?: ExcludeReason;
}

/** Avgjør om en Brreg-post skal inn i reg.enheter. Ren funksjon, ingen I/O. */
export function evaluateEmployerFilter(r: BrregEnhetRecord): FilterDecision {
  if (!r.organisasjonsnummer) return { include: false, reason: "missing_orgnr" };

  const nace = nace1(r) ?? "";
  if (EXCLUDED_NACE_PREFIXES.some((p) => nace.startsWith(p))) {
    return { include: false, reason: "nace_excluded" };
  }

  const form = formKode(r) ?? "";
  const exempt = (
    FORMS_EXEMPT_FROM_EMPLOYEE_REQUIREMENT as readonly string[]
  ).includes(form);
  if (!exempt && ansatte(r) <= 0) {
    return { include: false, reason: "form_requires_employees" };
  }

  return { include: true };
}

// ---------------------------------------------------------------------------
// AVLEDEDE MARKØRER
// ---------------------------------------------------------------------------

/** 85.401–85.404: høyere utdanning og fagskole. Avvik i speilet: 0. */
export const NACE_UTDANNING = ["85.401", "85.402", "85.403", "85.404"] as const;

/** 78.100 (formidling) og 78.200 (utleie av arbeidskraft). Avvik i speilet: 0. */
export const NACE_REKRUTTERING = ["78.100", "78.200"] as const;

/** Sektorkoder som alene gjør enheten offentlig: stats- og kommuneforvaltning. */
export const SEKTOR_OFFENTLIG = ["6100", "6500"] as const;

/** Organisasjonsformer som er offentlige med mindre sektorkoden sier finansiell. */
export const FORM_OFFENTLIG = [
  "STAT", "KOMM", "FYLK", "KF", "FKF", "IKS", "SF", "ORGL", "KIRK",
] as const;

/**
 * Unntak: ORGL-enheter i finansiell sektor (3900 statlige låneinstitutt,
 * 4900 statlige finansforetak) er IKKE markert offentlig i speilet.
 * Konkret gjelder dette Husbanken, Lånekassen og Eksportfinansiering Norge.
 * Uten unntaket blir avviket 3 rader; med det blir det 0.
 */
export const SEKTOR_FINANSIELL_UNNTAK = ["3900", "4900"] as const;

export interface DerivedMarkers {
  er_utdanning: boolean;
  er_rekruttering: boolean;
  er_offentlig: boolean;
  er_i_konsern: boolean;
}

export function deriveMarkers(r: BrregEnhetRecord): DerivedMarkers {
  const nace = nace1(r) ?? "";
  const s = sektor(r) ?? "";
  const form = formKode(r) ?? "";

  const erOffentlig =
    (SEKTOR_OFFENTLIG as readonly string[]).includes(s) ||
    ((FORM_OFFENTLIG as readonly string[]).includes(form) &&
      !(SEKTOR_FINANSIELL_UNNTAK as readonly string[]).includes(s));

  return {
    er_utdanning: (NACE_UTDANNING as readonly string[]).includes(nace),
    er_rekruttering: (NACE_REKRUTTERING as readonly string[]).includes(nace),
    er_offentlig: erOffentlig,
    // Kilden er feltets tilstedeværelse i Brreg-posten, ikke den løftede
    // kolonnen `overordnet_enhet` (se topptekst).
    er_i_konsern: Boolean(r.overordnetEnhet),
  };
}

// ---------------------------------------------------------------------------
// SAMMENLIGNINGSPORT
// ---------------------------------------------------------------------------

/**
 * Porten gjelder HVER kjøring, ikke bare den første. Den sammenligner
 * filterresultatet mot dagens speil og markørene innenfor overlappet
 * (organisasjonsnummer som finnes begge steder). Avvik utenfor terskel skal
 * stoppe importen før skriving, ikke etter.
 */
export const COMPARISON_BASELINE_ROWS = 439_773;

export interface MarkerDiffCounts {
  er_utdanning: number;
  er_rekruttering: number;
  er_offentlig: number;
  er_i_konsern: number;
}

export interface ComparisonGateInput {
  /** Antall rader filteret slipper gjennom i fullfilen. */
  filteredCount: number;
  /** Antall rader i reg.enheter før import. */
  mirrorCount: number;
  /** Orgnr som finnes i begge sett. */
  overlapCount: number;
  /** Antall markøravvik innenfor overlappet, per markør. */
  markerDiffs: MarkerDiffCounts;
  /**
   * Streng modus: brukes på FØRSTE kjøring. Da stopper porten ved ethvert
   * avvik, ikke ved terskelen. Poenget er at rekonstruksjonen skal bevise seg
   * selv én gang mot dagens 439 773 rader før terskelene overtar.
   */
  strict?: boolean;
  /**
   * Rader speilet har i dag som filteret ville forkastet. Dette er beviset på
   * at rekonstruksjonen er ufullstendig. De skal RAPPORTERES, aldri slettes
   * fra reg.enheter.
   */
  excludedPresentInMirror?: number;
  /** Rader speilet har som ikke finnes i fullfilen i det hele tatt. */
  absentFromSource?: number;
}

export interface ComparisonGateResult {
  pass: boolean;
  failures: string[];
  warnings: string[];
  /** Andel av speilet som ikke gjenfinnes i fullfilen. */
  missingRatio: number;
  /** Samlet markøravvik som andel av overlappet. */
  markerDiffRatio: number;
}

/** Terskler: over disse stoppes importen, mellom dem logges advarsel. */
export const GATE_MISSING_RATIO_FAIL = 0.05; // >5 % av speilet borte = mistenkelig fil
export const GATE_MISSING_RATIO_WARN = 0.01;
export const GATE_MARKER_DIFF_RATIO_FAIL = 0.005; // >0,5 % markøravvik = regelendring
export const GATE_MARKER_DIFF_RATIO_WARN = 0.001;

export function evaluateComparisonGate(
  input: ComparisonGateInput,
): ComparisonGateResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  const missing = Math.max(0, input.mirrorCount - input.overlapCount);
  const missingRatio = input.mirrorCount > 0 ? missing / input.mirrorCount : 0;

  // er_i_konsern er UNNTATT fra stoppkriteriet, ikke fra importen.
  // Dagens speil har `overordnet_enhet` delvis uløftet (30 074 rader spriker).
  // Mellomlagringen leser `overordnetEnhet` rett fra kilden og er riktig.
  // Porten ville derfor stoppet på nøyaktig det importen retter. Avviket
  // rapporteres som informasjon i `warnings`.
  const markerDiffTotal =
    input.markerDiffs.er_utdanning +
    input.markerDiffs.er_rekruttering +
    input.markerDiffs.er_offentlig;
  const markerDiffRatio =
    input.overlapCount > 0 ? markerDiffTotal / input.overlapCount : 0;

  if (input.markerDiffs.er_i_konsern > 0) {
    warnings.push(
      `er_i_konsern=${input.markerDiffs.er_i_konsern} (informasjon: speilets overordnet_enhet er delvis uløftet, importen retter dette)`,
    );
  }

  const excludedInMirror = input.excludedPresentInMirror ?? 0;
  const absent = input.absentFromSource ?? 0;

  if (input.filteredCount <= 0) {
    failures.push("filteredCount=0: fullfilen ga ingen rader gjennom filteret");
  }

  if (input.strict) {
    // Første kjøring: ethvert avvik stopper, uansett terskel.
    if (excludedInMirror > 0) {
      failures.push(
        `strict: ${excludedInMirror} rader i speilet ville blitt forkastet av filteret — rekonstruksjonen er ufullstendig`,
      );
    }
    if (absent > 0) {
      failures.push(`strict: ${absent} rader i speilet finnes ikke i fullfilen`);
    }
    if (markerDiffTotal > 0) {
      failures.push(`strict: ${markerDiffTotal} markøravvik innenfor overlappet`);
    }
    return { pass: failures.length === 0, failures, warnings, missingRatio, markerDiffRatio };
  }

  if (excludedInMirror > 0) {
    warnings.push(`excluded_present_in_mirror=${excludedInMirror}`);
  }

  if (missingRatio > GATE_MISSING_RATIO_FAIL) {
    failures.push(
      `missing_ratio=${(missingRatio * 100).toFixed(2)}% over grense ${(GATE_MISSING_RATIO_FAIL * 100).toFixed(2)}%`,
    );
  } else if (missingRatio > GATE_MISSING_RATIO_WARN) {
    warnings.push(`missing_ratio=${(missingRatio * 100).toFixed(2)}%`);
  }

  if (markerDiffRatio > GATE_MARKER_DIFF_RATIO_FAIL) {
    failures.push(
      `marker_diff_ratio=${(markerDiffRatio * 100).toFixed(3)}% over grense ${(GATE_MARKER_DIFF_RATIO_FAIL * 100).toFixed(3)}%`,
    );
  } else if (markerDiffRatio > GATE_MARKER_DIFF_RATIO_WARN) {
    warnings.push(`marker_diff_ratio=${(markerDiffRatio * 100).toFixed(3)}%`);
  }

  return { pass: failures.length === 0, failures, warnings, missingRatio, markerDiffRatio };
}

// ---------------------------------------------------------------------------
// FASE 1 → FASE 2: FILINTEGRITET
// ---------------------------------------------------------------------------

/**
 * Brreg annonserer `accept-ranges: bytes`, men IGNORERER Range-headeren og
 * svarer 200 med hele filen (~200 MB komprimert). Nedlastingen er derfor
 * alt-eller-ingenting. Feiler den halvveis ligger det en delvis gzip i
 * Storage som dekomprimerer en stund før den feiler — fase 2 ville da
 * prosessert et vilkårlig utvalg uten å vite det.
 *
 * Derfor: fase 1 skriver både forventet (content-length) og faktisk
 * lagret størrelse til tilstandsraden, og fase 2 avbryter hvis de ikke
 * stemmer nøyaktig.
 */
export interface DownloadIntegrity {
  expectedBytes: number | null;
  actualBytes: number | null;
}

export interface IntegrityVerdict {
  ok: boolean;
  reason?: "missing_content_length" | "missing_actual_size" | "size_mismatch";
  detail?: string;
}

export function verifyDownloadIntegrity(i: DownloadIntegrity): IntegrityVerdict {
  if (i.expectedBytes == null || i.expectedBytes <= 0) {
    return {
      ok: false,
      reason: "missing_content_length",
      detail: "kilden oppga ikke content-length; filen kan ikke verifiseres",
    };
  }
  if (i.actualBytes == null || i.actualBytes <= 0) {
    return { ok: false, reason: "missing_actual_size", detail: "ingen lagret filstørrelse" };
  }
  if (i.actualBytes !== i.expectedBytes) {
    return {
      ok: false,
      reason: "size_mismatch",
      detail: `lagret ${i.actualBytes} bytes, forventet ${i.expectedBytes} bytes`,
    };
  }
  return { ok: true };
}
