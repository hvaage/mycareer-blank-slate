// Mapping Brreg regnskap → reg.regnskap-rad. 1:1 port fra src/lib/regnskap-sync.normalize.ts.
// raw_data settes alltid til null (STORE_RAW=false i M5.2).

export type RegnskapRow = {
  organisasjonsnummer: string;
  regnskapsaar: number | null;
  brreg_regnskap_id: number | null;
  journalnr: string | null;
  regnskapstype: string;
  regnskap_dokumenttype: string | null;
  regnskapsperiode_fra: string | null;
  regnskapsperiode_til: string | null;
  morselskap: boolean | null;
  driftsinntekter: number | null;
  driftsresultat: number | null;
  aarsresultat: number | null;
  sum_egenkapital: number | null;
  sum_gjeld: number | null;
  sum_eiendeler: number | null;
  sum_egenkapital_gjeld: number | null;
  sum_omloepsmidler: number | null;
  sum_anleggsmidler: number | null;
  sum_driftskostnad: number | null;
  sum_finansinntekter: number | null;
  sum_finanskostnad: number | null;
  valuta: string;
  avviklingsregnskap: boolean | null;
  oppstillingsplan: string | null;
  smaa_foretak: boolean | null;
  regnskapsregler: string | null;
  ikke_revidert_aarsregnskap: boolean | null;
  fravalg_revisjon: boolean | null;
  raw_data: null;
};

function n(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function d(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
function regnskapsaar(row: any): number | null {
  const to = row?.regnskapsperiode?.tilDato;
  if (typeof to !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(to)) return null;
  const year = Number(to.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function regnskapRad(organisasjonsnummer: string, rr: any): RegnskapRow {
  const driftsresultat = rr?.resultatregnskapResultat?.driftsresultat;
  const resultat = rr?.resultatregnskapResultat;
  const finansresultat = resultat?.finansresultat;
  const egenkapitalGjeld = rr?.egenkapitalGjeld;
  const eiendeler = rr?.eiendeler;
  return {
    organisasjonsnummer,
    regnskapsaar: regnskapsaar(rr),
    brreg_regnskap_id: Number.isInteger(rr?.id) ? rr.id : null,
    journalnr: typeof rr?.journalnr === "string" ? rr.journalnr : null,
    regnskapstype: typeof rr?.regnskapstype === "string" ? rr.regnskapstype : "SELSKAP",
    regnskap_dokumenttype: typeof rr?.regnskapDokumenttype === "string" ? rr.regnskapDokumenttype : null,
    regnskapsperiode_fra: d(rr?.regnskapsperiode?.fraDato),
    regnskapsperiode_til: d(rr?.regnskapsperiode?.tilDato),
    morselskap: typeof rr?.virksomhet?.morselskap === "boolean" ? rr.virksomhet.morselskap : null,
    driftsinntekter: n(driftsresultat?.driftsinntekter?.sumDriftsinntekter),
    driftsresultat: n(driftsresultat?.driftsresultat),
    aarsresultat: n(resultat?.aarsresultat),
    sum_egenkapital: n(egenkapitalGjeld?.egenkapital?.sumEgenkapital),
    sum_gjeld: n(egenkapitalGjeld?.gjeldOversikt?.sumGjeld),
    sum_eiendeler: n(eiendeler?.sumEiendeler),
    sum_egenkapital_gjeld: n(egenkapitalGjeld?.sumEgenkapitalGjeld),
    sum_omloepsmidler: n(eiendeler?.omloepsmidler?.sumOmloepsmidler),
    sum_anleggsmidler: n(eiendeler?.anleggsmidler?.sumAnleggsmidler),
    sum_driftskostnad: n(driftsresultat?.driftskostnad?.sumDriftskostnad),
    sum_finansinntekter: n(finansresultat?.finansinntekt?.sumFinansinntekter),
    sum_finanskostnad: n(finansresultat?.finanskostnad?.sumFinanskostnad),
    valuta: typeof rr?.valuta === "string" ? rr.valuta : "NOK",
    avviklingsregnskap: typeof rr?.avviklingsregnskap === "boolean" ? rr.avviklingsregnskap : null,
    oppstillingsplan: typeof rr?.oppstillingsplan === "string" ? rr.oppstillingsplan : null,
    smaa_foretak: typeof rr?.regnkapsprinsipper?.smaaForetak === "boolean" ? rr.regnkapsprinsipper.smaaForetak : null,
    regnskapsregler: typeof rr?.regnkapsprinsipper?.regnskapsregler === "string" ? rr.regnkapsprinsipper.regnskapsregler : null,
    ikke_revidert_aarsregnskap: typeof rr?.revisjon?.ikkeRevidertAarsregnskap === "boolean" ? rr.revisjon.ikkeRevidertAarsregnskap : null,
    fravalg_revisjon: typeof rr?.revisjon?.fravalgRevisjon === "boolean" ? rr.revisjon.fravalgRevisjon : null,
    raw_data: null,
  };
}

export function sampleOk(orgnr: string): boolean {
  let h = 0;
  for (let i = 0; i < orgnr.length; i++) h = (h * 31 + orgnr.charCodeAt(i)) | 0;
  return Math.abs(h) % 100 === 0;
}
