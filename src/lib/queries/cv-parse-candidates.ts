/**
 * Karriereontologi v4 — gjennomgangsflyten (fase 2.3).
 *
 * Parselaget (`cv_parse_candidates`) holder maskinens tolkning. Ingenting der
 * er evidens. Det er gjennomgangen som promoterer enkeltatomer til
 * `career_atoms`, og det er brukerens valg som avgjør typen.
 *
 * Regler som håndheves her:
 * - Forslaget bæres av `suggested_atom_type`, valget av `resolved_atom_type`.
 * - Kompetanse (`skill`) uten pekere kan ikke bli atom — den blir et spørsmål.
 * - Eksponering (`domain`) krever at brukeren velger hvilken rolle den er avledet av.
 * - Ingenting slettes. Avviste kandidater beholder status `avvist`.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/integrations/supabase/types";
import { careerAtomLogicalKey } from "@/lib/career-atom-refresh";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";

export type CvParseCandidateRow = Tables<"cv_parse_candidates">;
export type CvImportRow = Tables<"cv_imports">;
export type CandidateStatus = "ubehandlet" | "bekreftet" | "avvist" | "ble_sporsmal";

export const CANDIDATE_ATOM_TYPES: CareerAtomType[] = [
  "role",
  "achievement",
  "metric",
  "context",
  "tool",
  "education",
  "skill",
  "domain",
  "language",
  "certification",
  "project",
  "volunteer",
  "summary_fragment",
];

/** Klassen typen havner i. Databasen eier `atom_class`; dette er kun visning. */
export const ATOM_TYPE_CLASS: Record<CareerAtomType, string | null> = {
  role: null,
  context: null,
  summary_fragment: null,
  skill: "kompetanse",
  domain: "eksponering",
  tool: "instrument",
  education: "kvalifikasjon",
  certification: "kvalifikasjon",
  language: "kvalifikasjon",
  achievement: "resultat",
  metric: "resultat",
  project: "resultat",
  volunteer: "resultat",
};

export const ATOM_TYPE_LABEL: Record<CareerAtomType, string> = {
  role: "Rolle",
  achievement: "Resultat",
  metric: "Måltall",
  context: "Kontekst",
  tool: "Verktøy",
  education: "Utdanning",
  skill: "Kompetanse",
  domain: "Eksponering",
  language: "Språk",
  certification: "Sertifisering",
  project: "Prosjekt",
  volunteer: "Frivillig arbeid",
  summary_fragment: "Oppsummering",
};

/** Kompetanse kan bare belegges indirekte og trenger minst én peker. */
export function requiresEvidencePointer(t: CareerAtomType): boolean {
  return t === "skill";
}

/** Eksponering er avledet av en rolle og krever at brukeren velger hvilken. */
export function requiresRoleParent(t: CareerAtomType): boolean {
  return t === "domain";
}

export function candidateTitle(c: CvParseCandidateRow): string {
  return (c.content_no ?? c.content_en ?? "Uten tekst").trim();
}

export function candidateSuggestedFromLexicon(c: CvParseCandidateRow): boolean {
  const sd = c.structured_data as Record<string, unknown> | null;
  return Boolean(sd && sd["suggested_from_name_lexicon"] === true);
}

// ---------------------------------------------------------------------------
// Lesing
// ---------------------------------------------------------------------------

export const cvImportsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["cv-imports", userId],
    queryFn: async (): Promise<CvImportRow[]> => {
      const { data, error } = await supabase
        .from("cv_imports")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
  });

export const cvParseCandidatesQuery = (userId: string, importId: string | null) =>
  queryOptions({
    queryKey: ["cv-parse-candidates", userId, importId],
    queryFn: async (): Promise<CvParseCandidateRow[]> => {
      let q = supabase.from("cv_parse_candidates").select("*").eq("user_id", userId);
      if (importId) q = q.eq("import_id", importId);
      const { data, error } = await q.order("local_ref", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
  });

/** Atomer som kan brukes som pekere (kvalifikasjon, resultat, rolle). */
export const evidencePointerAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["career-atoms", "pointer-candidates", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("career_atoms")
        .select("id, atom_type, atom_class, content_no, structured_data")
        .eq("user_id", userId)
        .eq("atom_kind", "evidens")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(userId),
  });

export function invalidateCandidateQueries(qc: QueryClient, userId: string): void {
  void qc.invalidateQueries({ queryKey: ["cv-parse-candidates", userId] });
  void qc.invalidateQueries({ queryKey: ["career-atoms"] });
  void qc.invalidateQueries({ queryKey: ["cv-imports", userId] });
  void qc.invalidateQueries({ queryKey: ["cv-atom-counts", userId] });
}

// ---------------------------------------------------------------------------
// Trestruktur — achievements skal vises under rollen de hører til
// ---------------------------------------------------------------------------

export interface CandidateNode {
  candidate: CvParseCandidateRow;
  children: CvParseCandidateRow[];
}

export function buildCandidateTree(rows: CvParseCandidateRow[]): {
  roles: CandidateNode[];
  standalone: CvParseCandidateRow[];
  orphans: CvParseCandidateRow[];
} {
  const byRef = new Map(rows.map((r) => [r.local_ref, r]));
  const roles: CandidateNode[] = [];
  const standalone: CvParseCandidateRow[] = [];
  const orphans: CvParseCandidateRow[] = [];

  for (const r of rows) {
    if (r.parent_local_ref) continue;
    if ((r.resolved_atom_type ?? r.suggested_atom_type) === "role") {
      roles.push({ candidate: r, children: [] });
    } else {
      standalone.push(r);
    }
  }
  const roleByRef = new Map(roles.map((n) => [n.candidate.local_ref, n]));
  for (const r of rows) {
    if (!r.parent_local_ref) continue;
    const node = roleByRef.get(r.parent_local_ref);
    if (node) node.children.push(r);
    else if (byRef.has(r.parent_local_ref)) standalone.push(r);
    else orphans.push(r);
  }
  return { roles, standalone, orphans };
}

// ---------------------------------------------------------------------------
// Skriving
// ---------------------------------------------------------------------------

export interface PromoteCandidateInput {
  userId: string;
  candidate: CvParseCandidateRow;
  resolvedType: CareerAtomType;
  /** Rollen eksponering/resultat er avledet av. */
  parentAtomId?: string | null;
  /** Pekere for kompetanse. */
  evidenceAtomIds?: string[];
  /** Brukeren bekrefter innholdet selv → confidence «verified». */
  verified: boolean;
}

/**
 * Promoterer én kandidat til ett atom, og merker kandidaten bekreftet.
 * Kaster med brukervendt tekst når ontologien ikke tillater atomet.
 */
export async function promoteCandidate(
  input: PromoteCandidateInput,
): Promise<{ atomId: string }> {
  const { userId, candidate, resolvedType, verified } = input;
  const pointers = input.evidenceAtomIds ?? [];
  const parentAtomId = input.parentAtomId ?? null;
  const title = candidateTitle(candidate);

  if (requiresEvidencePointer(resolvedType) && pointers.length === 0) {
    throw new Error(
      `«${title}» er en kompetanse og kan bare belegges indirekte. Velg minst én rolle, utdanning eller et resultat som viser hvor du har brukt den — eller gjør den til et spørsmål.`,
    );
  }
  if (requiresRoleParent(resolvedType) && !parentAtomId) {
    throw new Error(
      `«${title}» er eksponering. Velg hvilken rolle den er avledet av før du bekrefter.`,
    );
  }

  const structured: Record<string, unknown> = {
    ...((candidate.structured_data as Record<string, unknown> | null) ?? {}),
    parse_candidate_id: candidate.id,
    parse_local_ref: candidate.local_ref,
    import_id: candidate.import_id,
    suggested_atom_type: candidate.suggested_atom_type,
    resolved_by_user: candidate.suggested_atom_type !== resolvedType,
  };
  structured["logical_key"] = careerAtomLogicalKey({
    atom_kind: "evidens",
    atom_type: resolvedType,
    content_no: title,
    structured_data: structured,
  });

  const { data, error } = await supabase
    .from("career_atoms")
    .insert({
      user_id: userId,
      atom_kind: "evidens",
      atom_type: resolvedType,
      parent_atom_id: parentAtomId,
      content_no: title,
      content_en: candidate.content_en,
      structured_data: structured as Json,
      source_type: candidate.source_type,
      source_ref: candidate.source_ref,
      source_quote: candidate.source_quote,
      evidence_atom_ids: pointers,
      // Opprinnelse: brukeren har sett og bekreftet dette atomet i gjennomgangen.
      confidence: verified ? "verified" : "imported",
      user_confirmed: verified,
      refreshed_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: updErr } = await supabase
    .from("cv_parse_candidates")
    .update({
      status: "bekreftet",
      resolved_atom_type: resolvedType,
      promoted_atom_id: data.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .eq("user_id", userId);
  if (updErr) throw updErr;

  return { atomId: data.id };
}

/** Kompetanse uten evidens blir et spørsmål, ikke et atom. Ingenting slettes. */
export async function markCandidateAsQuestion(
  userId: string,
  candidate: CvParseCandidateRow,
  questionRef: string,
): Promise<void> {
  const { error } = await supabase
    .from("cv_parse_candidates")
    .update({
      status: "ble_sporsmal",
      question_ref: questionRef,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Avvist kandidat beholdes med status «avvist». Raden slettes aldri. */
export async function rejectCandidate(
  userId: string,
  candidate: CvParseCandidateRow,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("cv_parse_candidates")
    .update({
      status: "avvist",
      rejected_reason: reason?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Angrer en beslutning slik at kandidaten kan behandles på nytt. */
export async function reopenCandidate(
  userId: string,
  candidate: CvParseCandidateRow,
): Promise<void> {
  const { error } = await supabase
    .from("cv_parse_candidates")
    .update({ status: "ubehandlet", rejected_reason: null, question_ref: null })
    .eq("id", candidate.id)
    .eq("user_id", userId)
    .neq("status", "bekreftet");
  if (error) throw error;
}
