/**
 * CV-gjennomgang, trinn 1: karrieretidslinjen.
 *
 * Ren logikk uten datatilgang: leser datoer ut av det maskinen fant, sorterer
 * rollene kronologisk og finner hull. Ingenting her tolker eller fyller inn
 * datoer som ikke står i kilden — mangler dato, sier vi at den mangler.
 */
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";

export const TIMELINE_GAP_MIN_MONTHS = 6;

export interface TimelineRole {
  /** Kandidat-id når rollen kommer fra importen, atom-id når den er lagret. */
  id: string;
  kind: "kandidat" | "lagret";
  title: string;
  employer: string | null;
  startIso: string | null;
  endIso: string | null;
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

/** Normaliserer «2019», «2019-04», «04.2019», «2019-04-01» til ISO-dato. */
export function normalizeDateToIso(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^\d{4}$/.test(v)) return `${v}-01-01`;
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-01`;
  m = /^(\d{1,2})[./-](\d{4})$/.exec(v);
  if (m) return `${m[2]}-${m[1]!.padStart(2, "0")}-01`;
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export function isCurrentRole(sd: Sd): boolean {
  for (const k of ["is_current", "current", "naavaerende", "pagaende"]) {
    if (sd[k] === true) return true;
  }
  const end = str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]);
  return Boolean(end && /^(n[åa]|nu|present|current|d\.d\.?)$/i.test(end));
}

export function roleFromCandidate(c: CvParseCandidateRow): TimelineRole {
  const sd = (c.structured_data as Sd | null) ?? {};
  const startIso = normalizeDateToIso(
    str(sd, ["start_date", "startDate", "fra", "from", "startdato"]),
  );
  const endIso = normalizeDateToIso(str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]));
  const current = isCurrentRole(sd);
  return {
    id: c.id,
    kind: "kandidat",
    title: (c.content_no ?? c.content_en ?? "Uten tittel").trim(),
    employer: str(sd, ["employer", "company", "arbeidsgiver", "organisasjon"]),
    startIso,
    endIso: current ? null : endIso,
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
 * Finner hull mellom roller med kjente datoer. Roller uten startdato er ikke
 * med i hulldeteksjonen — vi gjetter ikke på perioder vi ikke kjenner.
 */
export function detectGaps(roles: TimelineRole[]): TimelineGap[] {
  const dated = roles
    .filter((r) => r.startIso)
    .map((r) => ({
      ...r,
      end: r.isCurrent ? new Date().toISOString().slice(0, 10) : (r.endIso ?? r.startIso!),
    }))
    .sort((a, b) => a.startIso!.localeCompare(b.startIso!));

  const gaps: TimelineGap[] = [];
  let covered: string | null = null;
  let coveredTitle = "";
  for (const r of dated) {
    if (covered && monthsBetween(covered, r.startIso!) >= TIMELINE_GAP_MIN_MONTHS) {
      gaps.push({
        key: `${covered}_${r.startIso}`,
        startIso: covered,
        endIso: r.startIso!,
        months: monthsBetween(covered, r.startIso!),
        afterTitle: coveredTitle,
        beforeTitle: r.title,
      });
    }
    if (!covered || r.end > covered) {
      covered = r.end;
      coveredTitle = r.title;
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
  const startIso = normalizeDateToIso(
    str(sd, ["start_date", "startDate", "fra", "from", "startdato"]),
  );
  const endIso = normalizeDateToIso(str(sd, ["end_date", "endDate", "til", "to", "sluttdato"]));
  const current = isCurrentRole(sd);
  return {
    id: atom.id,
    kind: "lagret",
    title: (atom.content_no ?? "Uten tittel").trim(),
    employer: str(sd, ["employer", "company", "arbeidsgiver", "organisasjon"]),
    startIso,
    endIso: current ? null : endIso,
    isCurrent: current,
    candidate: null,
    missingDates: !startIso,
  };
}
