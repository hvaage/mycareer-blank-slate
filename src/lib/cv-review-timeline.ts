/**
 * CV-gjennomgang, trinn 1: karrieretidslinjen.
 *
 * Ren logikk uten datatilgang: leser datoer ut av det maskinen fant, sorterer
 * rollene kronologisk og finner hull. Ingenting her tolker eller fyller inn
 * datoer som ikke står i kilden — mangler dato, sier vi at den mangler.
 */
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";

/**
 * Avtalt produktregel: hull under tre måneder markeres ikke. Hull på tre
 * måneder eller mer kan vises som «Mulig tidsrom å avklare», men bare når
 * begge datoene har tilstrekkelig presisjon (måned eller dag) og ingen av
 * rollene er pågående eller har en placeholderdato.
 */
export const TIMELINE_GAP_MIN_MONTHS = 3;

/** Datoer vi ser i importer når kilden egentlig ikke oppga noen dato. */
const PLACEHOLDER_DATES = new Set([
  "1900-01-01",
  "1901-01-01",
  "1970-01-01",
  "2000-01-01",
  "9999-12-31",
]);

export type DatePrecision = "dag" | "maned" | "ar";

export function isPlaceholderDate(iso: string | null): boolean {
  return Boolean(iso && PLACEHOLDER_DATES.has(iso));
}

/** Bare måneds- eller dagspresisjon er nøyaktig nok til å påstå et hull. */
export function hasSufficientGapPrecision(
  iso: string | null,
  precision: DatePrecision | null,
): boolean {
  if (!iso || isPlaceholderDate(iso)) return false;
  return precision === "dag" || precision === "maned";
}

export interface TimelineRole {
  /** Kandidat-id når rollen kommer fra importen, atom-id når den er lagret. */
  id: string;
  kind: "kandidat" | "lagret";
  /** Stillingstittelen slik den står i kilden. Tom streng når den mangler. */
  title: string;
  /** True når kilden ikke ga en stillingstittel — brukeren må spørres. */
  titleMissing: boolean;
  /** Rollebeskrivelsen, vist under tittelen. Aldri brukt som tittel. */
  summary: string | null;
  employer: string | null;
  startIso: string | null;
  endIso: string | null;
  startPrecision: DatePrecision | null;
  endPrecision: DatePrecision | null;
  isCurrent: boolean;
  candidate: CvParseCandidateRow | null;
  missingDates: boolean;
}

export interface TimelineGap {
  key: string;
  startIso: string;
  endIso: string;
  months: number;
  afterTitle: string;
  beforeTitle: string;
}

type Sd = Record<string, unknown>;

function str(sd: Sd, keys: string[]): string | null {
  for (const k of keys) {
    const v = sd[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Normaliserer «2019», «2019-04», «04.2019», «2019-04-01» til ISO-dato og
 * sier samtidig hvor presis kilden faktisk var. Presisjonen er avgjørende:
 * et årstall alene er ikke nøyaktig nok til å påstå et hull.
 */
export function normalizeDate(raw: string | null): {
  iso: string | null;
  precision: DatePrecision | null;
} {
  if (!raw) return { iso: null, precision: null };
  const v = raw.trim();
  if (/^\d{4}$/.test(v)) return { iso: `${v}-01-01`, precision: "ar" };
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(v);
  if (m) return { iso: `${m[1]}-${m[2]!.padStart(2, "0")}-01`, precision: "maned" };
  m = /^(\d{1,2})[./-](\d{4})$/.exec(v);
  if (m) return { iso: `${m[2]}-${m[1]!.padStart(2, "0")}-01`, precision: "maned" };
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (m) {
    return { iso: `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`, precision: "dag" };
  }
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v);
  if (m) {
    return { iso: `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`, precision: "dag" };
  }
  return { iso: null, precision: null };
}

export function normalizeDateToIso(raw: string | null): string | null {
  return normalizeDate(raw).iso;
}

export function isCurrentRole(sd: Sd): boolean {
  for (const k of ["is_current", "current", "naavaerende", "pagaende"]) {
    if (sd[k] === true) return true;
  }
  const end = str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]);
  return Boolean(end && /^(n[åa]|nu|present|current|d\.d\.?)$/i.test(end));
}

/**
 * En stillingstittel er kort og setningsløs. Rollebeskrivelser («Ledet den
 * kommersielle omstillingen …») er ikke titler, og skal aldri vises som det —
 * da spør vi heller brukeren.
 */
export function looksLikeJobTitle(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.trim();
  if (v.length < 2 || v.length > 70) return false;
  if (/[.!?]\s/.test(v)) return false;
  if (/[.!?]$/.test(v)) return false;
  return v.split(/\s+/).length <= 9;
}

/** Tittelen tas fra strukturfeltene, aldri fra rollebeskrivelsen. */
export function extractRoleTitle(sd: Sd): string | null {
  const t = str(sd, ["title", "stilling", "stillingstittel", "position", "job_title", "role"]);
  return looksLikeJobTitle(t) ? t : null;
}

function summaryOf(content: string | null, title: string | null): string | null {
  const v = content?.trim() ?? "";
  if (!v) return null;
  if (title && v.toLowerCase() === title.toLowerCase()) return null;
  return v;
}

export function roleFromCandidate(c: CvParseCandidateRow): TimelineRole {
  const sd = (c.structured_data as Sd | null) ?? {};
  const start = normalizeDate(str(sd, ["start_date", "startDate", "fra", "from", "startdato"]));
  const end = normalizeDate(str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]));
  const startIso = start.iso;
  const endIso = end.iso;
  const current = isCurrentRole(sd);
  const title = extractRoleTitle(sd);
  const content = c.content_no ?? c.content_en ?? null;
  return {
    id: c.id,
    kind: "kandidat",
    title: title ?? "",
    titleMissing: !title,
    summary: summaryOf(content, title),
    employer: str(sd, ["employer", "company", "arbeidsgiver", "organisasjon"]),
    startIso,
    endIso: current ? null : endIso,
    startPrecision: start.precision,
    endPrecision: current ? null : end.precision,
    isCurrent: current,
    candidate: c,
    missingDates: !startIso,
  };
}

export function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Kronologisk, nyeste først. Roller uten startdato havner sist. */
export function sortRoles(roles: TimelineRole[]): TimelineRole[] {
  return [...roles].sort((a, b) => {
    if (!a.startIso && !b.startIso) return a.title.localeCompare(b.title, "nb");
    if (!a.startIso) return 1;
    if (!b.startIso) return -1;
    return b.startIso.localeCompare(a.startIso);
  });
}

/**
 * Finner hull på tre måneder eller mer mellom roller med tilstrekkelig
 * presise datoer. Roller uten startdato, med placeholderdato, med bare
 * årstall eller som fortsatt pågår er ikke med — vi gjetter ikke på perioder
 * vi ikke kjenner.
 */
export function detectGaps(roles: TimelineRole[]): TimelineGap[] {
  const dated = roles
    .filter((r) => r.startIso && !isPlaceholderDate(r.startIso))
    .sort((a, b) => a.startIso!.localeCompare(b.startIso!));

  const gaps: TimelineGap[] = [];
  let covered: string | null = null;
  let coveredTitle = "";
  let coveredIsSafe = false;
  for (const r of dated) {
    // Pågående rolle dekker fram til i dag, men brukes aldri som hullkant.
    const end = r.isCurrent
      ? new Date().toISOString().slice(0, 10)
      : (r.endIso ?? r.startIso!);
    const endSafe =
      !r.isCurrent && Boolean(r.endIso) && hasSufficientGapPrecision(r.endIso, r.endPrecision);
    const startSafe = !r.isCurrent && hasSufficientGapPrecision(r.startIso, r.startPrecision);

    const months = covered ? monthsBetween(covered, r.startIso!) : 0;
    if (covered && coveredIsSafe && startSafe && months >= TIMELINE_GAP_MIN_MONTHS) {
      gaps.push({
        key: `${covered}_${r.startIso}`,
        startIso: covered,
        endIso: r.startIso!,
        months,
        afterTitle: coveredTitle,
        beforeTitle: r.title,
      });
    }
    if (!covered || end > covered) {
      covered = end;
      coveredTitle = r.title;
      coveredIsSafe = endSafe;
    }
  }
  return gaps;
}

/**
 * Signatur for kandidatsettet. Endres settet, er en påbegynt gjennomgang
 * ikke lenger gyldig, og brukeren må starte trinnene på nytt.
 */
export function candidateSetSignature(rows: { id: string; updated_at?: string | null }[]): string {
  const basis = rows
    .map((r) => `${r.id}:${r.updated_at ?? ""}`)
    .sort()
    .join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i += 1) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${rows.length}-${h1.toString(16)}${h2.toString(16)}`;
}

/** Lagret rolle fra karriereprofilen, vist på samme tidslinje. */
export function roleFromAtom(atom: {
  id: string;
  content_no: string | null;
  structured_data: unknown;
}): TimelineRole {
  const sd = ((atom.structured_data as Sd | null) ?? {}) as Sd;
  const start = normalizeDate(str(sd, ["start_date", "startDate", "fra", "from", "startdato"]));
  const end = normalizeDate(str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]));
  const startIso = start.iso;
  const endIso = end.iso;
  const current = isCurrentRole(sd);
  const content = atom.content_no?.trim() ?? null;
  const title = extractRoleTitle(sd) ?? (looksLikeJobTitle(content) ? content : null);
  return {
    id: atom.id,
    kind: "lagret",
    title: title ?? "",
    titleMissing: !title,
    summary: summaryOf(content, title),
    employer: str(sd, ["employer", "company", "arbeidsgiver", "organisasjon"]),
    startIso,
    endIso: current ? null : endIso,
    startPrecision: start.precision,
    endPrecision: current ? null : end.precision,
    isCurrent: current,
    candidate: null,
    missingDates: !startIso,
  };
}

// ---------------------------------------------------------------------------
// Dubletter på tvers av importer
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-_./,]+/g, " ")
    .replace(/\s+/g, " ");
}

function overlaps(a: TimelineRole, b: TimelineRole): boolean {
  if (!a.startIso || !b.startIso) return false;
  const aEnd = a.isCurrent ? "9999-12-31" : (a.endIso ?? a.startIso);
  const bEnd = b.isCurrent ? "9999-12-31" : (b.endIso ?? b.startIso);
  return a.startIso <= bEnd && b.startIso <= aEnd;
}

export interface TimelineDuplicateGroup {
  key: string;
  roles: TimelineRole[];
  reason: string;
}

/**
 * Flere importer av samme CV gir samme rolle flere ganger. Vi slår aldri
 * sammen automatisk — vi peker på gruppen og lar brukeren slette det som er
 * overflødig. Kriteriet er samme arbeidsgiver med overlappende periode, og
 * enten samme tittel eller manglende tittel på én av dem.
 */
export function findDuplicateRoles(roles: TimelineRole[]): TimelineDuplicateGroup[] {
  const groups: TimelineRole[][] = [];

  for (const r of roles) {
    if (!r.employer || !r.startIso) continue;
    const hit = groups.find((g) =>
      g.some(
        (x) =>
          norm(x.employer) === norm(r.employer) &&
          overlaps(x, r) &&
          (norm(x.title) === norm(r.title) || !x.title || !r.title),
      ),
    );
    if (hit) hit.push(r);
    else groups.push([r]);
  }

  return groups
    .filter((g) => g.length > 1)
    .map((g) => ({
      key: g.map((r) => `${r.kind}-${r.id}`).join("|"),
      roles: g,
      reason: `Samme arbeidsgiver (${g[0]!.employer}) med overlappende periode`,
    }));
}
