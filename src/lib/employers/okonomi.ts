/**
 * Lesbare beløp og klartekst om økonomien.
 *
 * Et tall alene forteller en jobbsøker lite. "Gjeldsgrad 9,9" er meningsløst
 * uten å vite om det er normalt. Derfor: formatering som er til å lese, og
 * korte forklaringer i klartekst ved siden av tallet.
 */

const nf = (maks: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: maks });

/** "15,4 mrd kr", ikke "15 377 000 000 kr". */
export function fmtBelop(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  const tegn = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${tegn}${nf(1).format(abs / 1_000_000_000)} mrd kr`;
  if (abs >= 1_000_000) return `${tegn}${nf(abs >= 100_000_000 ? 0 : 1).format(abs / 1_000_000)} mill kr`;
  if (abs >= 10_000) return `${tegn}${nf(0).format(abs / 1000)} 000 kr`;
  return `${tegn}${nf(0).format(abs)} kr`;
}

export function fmtProsent(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${nf(1).format(n)} %`;
}

export function fmtGjeldsgrad(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${nf(1).format(n)}x`;
}

export function fmtAar(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `${nf(0).format(n)} år`;
}

/**
 * Forklarer avviket mellom driftsresultat og årsresultat når finanspostene
 * er det som avgjør året. Uten dette står to motstridende tall ubemerket.
 */
export function forklarResultatavvik(d: {
  driftsresultat?: number | null;
  aarsresultat?: number | null;
  sum_finansinntekter?: number | null;
}): string | null {
  const drift = d.driftsresultat;
  const aar = d.aarsresultat;
  if (typeof drift !== "number" || typeof aar !== "number") return null;
  const avvik = aar - drift;
  if (Math.abs(avvik) < Math.max(Math.abs(drift) * 0.2, 1_000_000)) return null;

  const fin = typeof d.sum_finansinntekter === "number" ? d.sum_finansinntekter : null;
  const finTekst = fin ? ` Finansinntektene var ${fmtBelop(fin)}.` : "";

  if (drift < 0 && aar >= 0) {
    return `Driften gikk med underskudd (${fmtBelop(drift)}), men året endte i pluss (${fmtBelop(aar)}). Forskjellen kommer fra poster utenfor driften, typisk renter, utbytte fra andre selskaper eller gevinster.${finTekst}`;
  }
  if (drift >= 0 && aar < 0) {
    return `Driften gikk i pluss (${fmtBelop(drift)}), men året endte i minus (${fmtBelop(aar)}). Forskjellen ligger utenfor driften, typisk finanskostnader, nedskrivninger eller skatt.${finTekst}`;
  }
  return `Årsresultatet (${fmtBelop(aar)}) avviker vesentlig fra driftsresultatet (${fmtBelop(drift)}). Forskjellen ligger i poster utenfor driften.${finTekst}`;
}

export type Vurdering = "svak" | "normal" | "sterk";

export type Soliditetsforklaring = {
  vurdering: Vurdering;
  tekst: string;
};

/**
 * Egenkapitalandel og gjeldsgrad i klartekst. Grensene er tommelfingerregler
 * for norske aksjeselskaper, ikke bransjejusterte normtall, og det sies i teksten.
 */
export function forklarSoliditet(d: {
  egenkapitalandel_prosent?: number | null;
  gjeldsgrad?: number | null;
}): Soliditetsforklaring | null {
  const ek = d.egenkapitalandel_prosent;
  if (typeof ek !== "number") return null;
  const gg = typeof d.gjeldsgrad === "number" ? d.gjeldsgrad : null;
  const ggTekst = gg ? ` Gjeldsgrad ${fmtGjeldsgrad(gg)} betyr at gjelden er ${fmtGjeldsgrad(gg)?.replace("x", " ganger")} egenkapitalen.` : "";

  if (ek < 15) {
    return {
      vurdering: "svak",
      tekst: `Egenkapitalandelen er ${fmtProsent(ek)}. Det er lavt: mesteparten av verdiene er finansiert med gjeld, og selskapet tåler mindre motgang før egenkapitalen er brukt opp.${ggTekst} Lav egenkapital er samtidig vanlig i konsernselskaper som finansieres av morselskapet, så tallet alene sier ikke at selskapet er i fare.`,
    };
  }
  if (ek < 35) {
    return {
      vurdering: "normal",
      tekst: `Egenkapitalandelen er ${fmtProsent(ek)}, som er innenfor det vanlige for norske aksjeselskaper.${ggTekst}`,
    };
  }
  return {
    vurdering: "sterk",
    tekst: `Egenkapitalandelen er ${fmtProsent(ek)}. Selskapet er solid finansiert og tåler svake år uten å måtte hente inn ny kapital.${ggTekst}`,
  };
}

/** Kort forklaring til hvert risikoflagg, og om det bør dempes. */
export function forklarRisikoflagg(
  flagg: string,
  d: { aarsresultat?: number | null; driftsresultat?: number | null },
): { tekst: string; dempet: boolean } {
  switch (flagg) {
    case "negativt_driftsresultat": {
      const positivtAar = typeof d.aarsresultat === "number" && d.aarsresultat > 0;
      return {
        tekst: positivtAar
          ? "Driften gikk med underskudd i siste regnskapsår, men året endte samlet i pluss. Verdt å merke seg, ikke nødvendigvis et faresignal."
          : "Driften gikk med underskudd i siste regnskapsår.",
        dempet: positivtAar,
      };
    }
    case "negativt_aarsresultat":
      return { tekst: "Selskapet endte siste regnskapsår med underskudd.", dempet: false };
    case "negativ_egenkapital":
      return {
        tekst: "Egenkapitalen er negativ: gjelden overstiger verdiene i balansen.",
        dempet: false,
      };
    case "hoy_gjeldsgrad":
      return {
        tekst: "Gjelden er høy sammenlignet med egenkapitalen.",
        dempet: false,
      };
    case "konkurs":
      return { tekst: "Registrert konkurs i Enhetsregisteret.", dempet: false };
    case "under_avvikling":
      return { tekst: "Registrert under avvikling i Enhetsregisteret.", dempet: false };
    default:
      return {
        tekst: "Flagget kommer fra register- og regnskapsdata for siste tilgjengelige år.",
        dempet: false,
      };
  }
}

export function humaniserFlagg(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
