/**
 * Kvalitetsvurdering av importerte selskapsnavn.
 *
 * LinkedIn-eksporter inneholder felt der kontakten selv har skrevet noe annet
 * enn et selskapsnavn: bare symboler/emoji, hashtag-kampanjer, podkast-reklame
 * eller lange slagord. Reglene under er bevisst konservative: ekte, korte navn
 * med tall (7-Eleven, 7N, A-2 Norge AS) skal alltid beholdes.
 */

export type CompanyNameQuality =
  | "ok"
  | "symbol_only"
  | "hashtag_promo"
  | "url"
  | "promotional"
  | "too_long";

const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Reklame-/kampanjemarkører som aldri forekommer i et reelt registrert selskapsnavn. */
const PROMO_PATTERNS: RegExp[] = [
  /\bpodkast\b/iu,
  /\bpodcast\b/iu,
  /\bfølg\s+(meg|oss)\b/iu,
  /\bvi\s+hjelper\b/iu,
  /\bopen\s+to\s+work\b/iu,
  /\bsøker\s+(ny\s+)?jobb\b/iu,
  /\bledig\s+for\s+oppdrag\b/iu,
  /\bkontakt\s+meg\b/iu,
];

const MAX_REASONABLE_LENGTH = 70;

export function classifyCompanyName(raw: string | null | undefined): CompanyNameQuality {
  const name = (raw ?? "").trim();
  if (!name) return "symbol_only";

  // Ingen bokstav og intet tall igjen = kun symboler/emoji.
  if (!LETTER_OR_DIGIT.test(name)) return "symbol_only";

  // Navn helt uten bokstaver (kun tall/tegn) er ikke et selskapsnavn.
  if (!LETTER.test(name)) return "symbol_only";

  if (/^[#＃]/u.test(name) || /(^|\s)#\p{L}/u.test(name)) return "hashtag_promo";

  if (/(https?:\/\/|www\.)/iu.test(name)) return "url";

  if (PROMO_PATTERNS.some((re) => re.test(name))) return "promotional";

  if (name.length > MAX_REASONABLE_LENGTH) return "too_long";

  return "ok";
}

/**
 * Fjerner en lenke som er limt inn etter selskapsnavnet
 * («Heber hodejeger - https://…» → «Heber hodejeger»).
 */
export function sanitizeCompanyName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  if (!name) return "";
  const withoutUrl = name
    .replace(/\s*[-–—|,]?\s*(https?:\/\/|www\.)\S+/giu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return withoutUrl.replace(/[\s,;:.\-–—|]+$/u, "").trim() || name;
}

/**
 * True kun når navnet med sikkerhet ikke er et selskapsnavn.
 * Lange navn og navn med innlimt lenke beholdes (brukeren kan fjerne dem selv);
 * de skjules ikke automatisk, siden reelle selskaper kan se slik ut.
 */
export function isJunkCompanyName(raw: string | null | undefined): boolean {
  const quality = classifyCompanyName(sanitizeCompanyName(raw));
  return quality === "symbol_only" || quality === "hashtag_promo" || quality === "promotional";
}

export const COMPANY_NAME_QUALITY_LABEL: Record<CompanyNameQuality, string> = {
  ok: "Godkjent",
  symbol_only: "Kun symboler",
  hashtag_promo: "Hashtag/kampanje",
  url: "Lenke",
  promotional: "Reklametekst",
  too_long: "For langt til å være et navn",
};
