/**
 * CV-gjennomgang, trinn 3: forslag til plassering av kompetanse.
 *
 * Ren logikk uten datatilgang. Modulen foreslår hvilke roller og resultater
 * en kompetanse hører til, og sier hvorfor. Den fabrikkerer aldri en
 * begrunnelse: mangler parseren strukturell kobling, kildesitat eller
 * tidsinformasjon, blir forslaget «trenger vurdering» uten plassering.
 *
 * Sammensatte kompetanser splittes ikke her — det hører til
 * normaliserings-/konverterlaget (cv-evidence-graph).
 */
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";

export type SkillSignalKind = "strukturell" | "kilde" | "tekst";

export interface SkillSignal {
  kind: SkillSignalKind;
  label: string;
}

export interface SuggestionRole {
  atomId: string;
  title: string;
  employer: string | null;
}

export interface SuggestionResult {
  atomId: string;
  title: string;
  roleAtomId: string | null;
}

export type SkillConfidence = "hoy" | "middels" | "lav";

export interface SkillSuggestion {
  candidate: CvParseCandidateRow;
  title: string;
  roles: SuggestionRole[];
  results: SuggestionResult[];
  signals: SkillSignal[];
  confidence: SkillConfidence;
  /** Kort, konkret begrunnelse bygget av faktiske signaler. */
  reason: string;
  /** Kan inngå i «Bekreft alle N». Krever strukturelt/kildebasert + tekstsignal. */
  bulkEligible: boolean;
  /** Ingen plasseringsgrunnlag i det hele tatt — vises som «trenger vurdering». */
  needsReview: boolean;
}

const SKILL_TYPES = new Set(["skill", "domain"]);

export function isSkillCandidate(c: CvParseCandidateRow): boolean {
  const t = (c.resolved_atom_type ?? c.suggested_atom_type ?? "") as string;
  return SKILL_TYPES.has(t);
}

export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ordgrense-treff, ikke delstreng: «R» skal ikke treffe «Rådgiver». */
export function mentions(haystack: string, term: string): boolean {
  const h = normalizeTerm(haystack);
  const t = normalizeTerm(term);
  if (t.length < 3 || !h) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "u").test(h);
}

function hasTimeInfo(c: CvParseCandidateRow): boolean {
  const sd = (c.structured_data ?? {}) as Record<string, unknown>;
  return Boolean(sd["start_date"] || sd["end_date"] || sd["period"] || sd["year"]);
}

export interface BuildSuggestionsInput {
  candidates: CvParseCandidateRow[];
  roles: SuggestionRole[];
  results: SuggestionResult[];
  /** local_ref → promotert atom-id, fra bekreftede kandidater. */
  promotedByLocalRef: Map<string | null, string | null>;
}

export function buildSkillSuggestions(input: BuildSuggestionsInput): SkillSuggestion[] {
  const roleById = new Map(input.roles.map((r) => [r.atomId, r] as const));

  return input.candidates.map((candidate) => {
    const title = (candidate.content_no ?? candidate.content_en ?? "").trim();
    const signals: SkillSignal[] = [];
    const roleIds = new Set<string>();
    const resultIds = new Set<string>();

    // 1. Strukturelt signal: parseren plasserte kompetansen under en rolle
    //    som brukeren allerede har bekreftet.
    const parentAtomId = candidate.parent_local_ref
      ? (input.promotedByLocalRef.get(candidate.parent_local_ref) ?? null)
      : null;
    const parentRole = parentAtomId ? roleById.get(parentAtomId) : undefined;
    if (parentRole) {
      roleIds.add(parentRole.atomId);
      signals.push({
        kind: "strukturell",
        label: `Sto under «${parentRole.title}» i CV-en`,
      });
    }

    // 2. Kildesignal: sitatet fra CV-en nevner et bekreftet resultat.
    const quote = (candidate.source_quote ?? "").trim();
    if (quote) {
      const quoted = input.results.filter((r) => r.title && mentions(quote, r.title.slice(0, 40)));
      for (const r of quoted) {
        resultIds.add(r.atomId);
        if (r.roleAtomId) roleIds.add(r.roleAtomId);
      }
      if (quoted.length > 0) {
        signals.push({
          kind: "kilde",
          label: `Nevnt i samme punkt som «${quoted[0]!.title}»`,
        });
      }
    }

    // 3. Tekstsignal: kompetansen nevnes ordrett i et bekreftet resultat
    //    eller i en rolletittel. Flere treff er fortsatt ett signal.
    const textResults = title ? input.results.filter((r) => mentions(r.title, title)) : [];
    const textRoles = title ? input.roles.filter((r) => mentions(r.title, title)) : [];
    for (const r of textResults) {
      resultIds.add(r.atomId);
      if (r.roleAtomId) roleIds.add(r.roleAtomId);
    }
    for (const r of textRoles) roleIds.add(r.atomId);
    if (textResults.length > 0 || textRoles.length > 0) {
      const where = textResults[0]?.title ?? textRoles[0]?.title ?? "";
      signals.push({ kind: "tekst", label: `Nevnes ordrett i «${where}»` });
    }

    const hasStrong = signals.some((s) => s.kind === "strukturell" || s.kind === "kilde");
    const hasText = signals.some((s) => s.kind === "tekst");
    const bulkEligible = hasStrong && hasText;
    const needsReview =
      signals.length === 0 && !candidate.parent_local_ref && !quote && !hasTimeInfo(candidate);

    const confidence: SkillConfidence = bulkEligible ? "hoy" : hasStrong ? "middels" : "lav";

    const reason = needsReview
      ? "Vi fant ingen kobling til rolle eller resultat i CV-en. Velg selv hvor den hører hjemme."
      : signals.length > 0
        ? signals.map((s) => s.label).join(". ") + "."
        : "Kompetansen står oppført i CV-en, men uten kobling til en rolle eller et resultat.";

    return {
      candidate,
      title: title || "Uten tekst",
      roles: [...roleIds].map((id) => roleById.get(id)).filter((r): r is SuggestionRole => Boolean(r)),
      results: [...resultIds]
        .map((id) => input.results.find((r) => r.atomId === id))
        .filter((r): r is SuggestionResult => Boolean(r)),
      signals,
      confidence,
      reason,
      bulkEligible,
      needsReview,
    };
  });
}

export const SKILL_CONFIDENCE_LABEL: Record<SkillConfidence, string> = {
  hoy: "Høy sikkerhet",
  middels: "Middels sikkerhet",
  lav: "Trenger vurdering",
};
