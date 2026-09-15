/**
 * Rene layoutregler for PDF-eksporten.
 *
 * Skilt ut fra selve PDF-byggingen slik at sideskiftreglene kan testes uten
 * nettleser: ingen overskrift alene nederst på en side, og ingen enkeltstående
 * («orfan») avsnittslinje verken nederst eller øverst på en side.
 */

/** Antall linjer som får plass i tilgjengelig høyde. */
export function fittingLineCount(available: number, lineHeight: number): number {
  if (lineHeight <= 0) return 0;
  return Math.max(0, Math.floor((available + 1e-9) / lineHeight));
}

export type ParagraphSplit = {
  /** Linjer som skrives på gjeldende side. 0 betyr: start ny side først. */
  placeNow: number;
  /** Linjer som flyttes til neste side. */
  remainder: number;
};

/**
 * Fordeler et avsnitt mellom gjeldende og neste side.
 *
 * Regler:
 * - Alt som får plass, skrives ut.
 * - Et avsnitt deles aldri slik at bare én linje blir igjen på en av sidene.
 * - Får færre enn to linjer plass, flyttes hele avsnittet.
 */
export function planParagraphSplit(
  totalLines: number,
  maxFit: number,
): ParagraphSplit {
  const total = Math.max(0, Math.floor(totalLines));
  const fit = Math.max(0, Math.floor(maxFit));
  if (total === 0) return { placeNow: 0, remainder: 0 };
  if (fit >= total) return { placeNow: total, remainder: 0 };
  if (total === 1) return { placeNow: 0, remainder: 1 };

  // Del bare når begge sider får minst to linjer.
  let placeNow = fit;
  if (total - placeNow === 1) placeNow -= 1;
  if (placeNow < 2) return { placeNow: 0, remainder: total };
  return { placeNow, remainder: total - placeNow };
}

/**
 * En overskrift skrives bare når den etterfølges av minst to innholdslinjer
 * (eller alle linjene, når blokken er kortere) på samme side.
 */
export function headingFits(
  available: number,
  headingHeight: number,
  lineHeight: number,
  followingLines: number,
): boolean {
  const required =
    headingHeight + lineHeight * Math.min(2, Math.max(0, followingLines));
  return available + 1e-9 >= required;
}
