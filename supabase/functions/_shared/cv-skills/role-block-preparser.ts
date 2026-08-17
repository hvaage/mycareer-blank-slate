// Deterministisk pre-parser for cv-atom-language-no v2.1.0.
//
// Bygger CvAtomizationInput fra parse-kandidatene i en CV-import. Alt her er
// rent deterministisk: ingen modellkall, ingen database, ingen tilførte fakta.
// Modellen får aldri rå CV-tekst uten struktur — den får kildespenn og
// rolleblokker, slik at rollegrenser kan valideres i stedet for gjettes.

import type {
  CvAtomizationInput,
  RoleBlock,
  SectionHint,
  SourceSpan,
} from "./vendor/cv-atom-language-no/v2/types.ts";

export const PREPARSER_VERSION = "2.1.0";

export type PreparserCandidate = {
  id: string;
  local_ref: string;
  parent_local_ref: string | null;
  suggested_atom_type: string | null;
  content_no: string | null;
  structured_data: Record<string, unknown> | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sectionHintFor(type: string | null): SectionHint {
  switch (type) {
    case "role":
    case "achievement":
    case "metric":
    case "project":
    case "volunteer":
      return "experience";
    case "education":
      return "education";
    case "skill":
    case "tool":
    case "language":
    case "certification":
      return "skills";
    case "summary_fragment":
      return "summary";
    default:
      return "other";
  }
}

/** Stabil gruppenøkkel for ett ansettelsesforhold. Aldri en rolleidentitet. */
export function employmentGroupKey(employer: string | null): string | null {
  if (!employer) return null;
  const normalized = employer
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return null;
  return `emp:${normalized}`;
}

function datePrecision(start: string | null, end: string | null): "month" | "year" | null {
  const sample = start ?? end;
  if (!sample) return null;
  if (/^\d{4}-\d{2}/.test(sample)) return "month";
  if (/^\d{4}$/.test(sample)) return "year";
  return null;
}

const HINT_PATTERNS: Array<{ hint: string; re: RegExp }> = [
  { hint: "successive_language", re: /\b(consecutive|successive|etterfølgende|påfølgende)\b/i },
  { hint: "promotion_language", re: /\b(promoted to|forfremmet|opprykk|avansert til)\b/i },
  { hint: "concurrent_language", re: /\b(concurrent|simultaneously|samtidig|parallelt|i tillegg til rollen)\b/i },
  { hint: "compound_title_ampersand", re: /\s(&|and|og)\s/i },
  { hint: "compound_title_slash", re: /\S\s*\/\s*\S/ },
  { hint: "compound_title_comma", re: /,\s*\p{Lu}/u },
  { hint: "inner_period_reference", re: /\((?:[A-Za-zÆØÅæøå .]*)?\d{4}\s*[–-]\s*(\d{4}|nå|present)\)/i },
  { hint: "role_label_in_text", re: /\b(as|som)\s+(COO|CTO|CEO|CCO|CFO|VP|Director|Lead|Manager|Head of)\b/i },
];

/**
 * Eksplisitt navngitt utnevnelse inne i en rolleblokk, f.eks.
 * «... as COO, Cisco Norway (2019–2024)». Kun det som står i kilden — her
 * utledes ingen tittel og ingen periode som ikke er skrevet.
 */
const INNER_APPOINTMENT_RE =
  /\b(?:as|som)\s+([A-Za-zÆØÅæøå&/. ]{3,60}?)\s*(?:,[^()]{0,60})?\((\d{4})\s*[–-]\s*(\d{4}|nå|present)\)/gi;

export function detectInnerAppointments(texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(INNER_APPOINTMENT_RE)) {
      const title = (match[1] ?? "").trim().replace(/\s+/g, " ");
      if (!title) continue;
      out.add(`inner_appointment:${title}|${match[2]}-${match[3]}`);
    }
  }
  return [...out];
}

function hintsFor(texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const { hint, re } of HINT_PATTERNS) {
      if (re.test(text)) found.add(hint);
    }
  }
  for (const appointment of detectInnerAppointments(texts)) found.add(appointment);
  return [...found].sort();
}

function detectLanguage(texts: string[]): "no" | "en" | "mixed" {
  const sample = texts.join(" ").toLowerCase();
  const no = (sample.match(/\b(og|som|ansvar|ledet|utviklet|for|med|arbeid)\b/g) ?? []).length;
  const en = (sample.match(/\b(and|the|with|led|responsible|built|team)\b/g) ?? []).length;
  if (no === 0 && en === 0) return "no";
  if (no > en * 2) return "no";
  if (en > no * 2) return "en";
  return "mixed";
}

/**
 * Bygger modellinput. Rekkefølgen er kandidatrekkefølgen, og hvert kildespenn
 * hører til nøyaktig én rolleblokk eller til unassignedSpans.
 */
export function buildAtomizationInput(candidates: PreparserCandidate[]): CvAtomizationInput {
  const sourceSpans: SourceSpan[] = [];
  const byRef = new Map<string, PreparserCandidate>();

  for (const c of candidates) {
    byRef.set(c.local_ref, c);
    sourceSpans.push({
      id: c.local_ref,
      text: c.content_no ?? "",
      sectionHint: sectionHintFor(c.suggested_atom_type),
      localRef: c.local_ref,
      parentLocalRef: c.parent_local_ref,
      page: null,
      startOffset: null,
      endOffset: null,
    });
  }

  const childrenByParent = new Map<string, PreparserCandidate[]>();
  for (const c of candidates) {
    if (!c.parent_local_ref) continue;
    const list = childrenByParent.get(c.parent_local_ref) ?? [];
    list.push(c);
    childrenByParent.set(c.parent_local_ref, list);
  }

  const assigned = new Set<string>();
  const roleBlocks: RoleBlock[] = [];

  for (const c of candidates) {
    if (c.suggested_atom_type !== "role") continue;
    const sd = c.structured_data ?? {};
    const children = childrenByParent.get(c.local_ref) ?? [];
    const spanIds = [c.local_ref, ...children.map((child) => child.local_ref)];
    for (const id of spanIds) assigned.add(id);

    const title = str(sd["title"]);
    const employer = str(sd["employer"]);
    const start = str(sd["start_date"]);
    const end = str(sd["end_date"]);
    const texts = [
      title ?? "",
      c.content_no ?? "",
      ...children.map((child) => child.content_no ?? ""),
    ].filter((t) => t.length > 0);

    roleBlocks.push({
      id: c.local_ref,
      sourceSpanIds: spanIds,
      rawText: [title, employer, c.content_no].filter(Boolean).join(" — "),
      title,
      employer,
      startDate: start,
      endDate: end,
      datePrecision: datePrecision(start, end),
      employmentGroupKey: employmentGroupKey(employer),
      appointmentHints: hintsFor(texts),
    });
  }

  const unassignedSpans = sourceSpans.map((s) => s.id).filter((id) => !assigned.has(id));

  return {
    documentLanguage: detectLanguage(sourceSpans.map((s) => s.text)),
    sourceSpans,
    roleBlocks,
    unassignedSpans,
    normalizerVersion: PREPARSER_VERSION,
  };
}

/** Delmengde av input for én delbatch, uten å miste rolleblokk-konteksten. */
export function narrowInputToCandidates(
  input: CvAtomizationInput,
  candidateRefs: string[],
): CvAtomizationInput {
  const keep = new Set(candidateRefs);
  const roleBlocks = input.roleBlocks.filter((block) =>
    block.sourceSpanIds.some((id) => keep.has(id)),
  );
  for (const block of roleBlocks) for (const id of block.sourceSpanIds) keep.add(id);
  const sourceSpans = input.sourceSpans.filter((span) => keep.has(span.id));
  return {
    ...input,
    sourceSpans,
    roleBlocks,
    unassignedSpans: input.unassignedSpans.filter((id) => keep.has(id)),
  };
}
