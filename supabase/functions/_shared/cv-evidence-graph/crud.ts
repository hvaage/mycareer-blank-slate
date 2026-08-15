// cv-evidence-graph — Supabase CRUD wrappers
// Skjema-versjon: 4.0 (parselaget)
//
// Tynne wrappers rundt `public.cv_parse_candidates`. Dette laget skriver ALDRI
// til career_atoms: en kandidat blir evidens først når brukeren bekrefter den
// i gjennomgangen, og den promoteringen eies av applikasjonslaget.

import type {
  CvParseCandidate,
  CandidateInsert,
  CandidateStatus,
  AtomType,
} from "./types.ts";
import { parseCandidateRow } from "./types.ts";
import { validateCandidate, type ValidationResult } from "./validators.ts";

const TABLE = "cv_parse_candidates";

// ---------------------------------------------------------------------------
// Generic Supabase client interface — fungerer med både @supabase/supabase-js
// og Deno-versjonene. Edge-funksjoner sender service-role-klient,
// frontend sender bruker-scoped klient.
// ---------------------------------------------------------------------------

export type SupabaseLike = {
  from: (table: string) => unknown;
};

type Chain = {
  select: (columns?: string) => Chain;
  insert: (rows: unknown) => Chain;
  update: (row: unknown) => Chain;
  delete: () => Chain;
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, values: unknown[]) => Chain;
  order: (column: string, opts?: { ascending?: boolean }) => Chain;
};

function table(supabase: SupabaseLike): Chain {
  return (supabase as { from: (t: string) => Chain }).from(TABLE);
}

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Hent kandidatene i én import. Default: hele importen, uansett status. */
export async function fetchImportCandidates(
  supabase: SupabaseLike,
  import_id: string,
  opts: { status?: CandidateStatus[] } = {},
): Promise<CvParseCandidate[]> {
  let query = table(supabase).select("*").eq("import_id", import_id);

  if (opts.status && opts.status.length > 0) {
    query = query.in("status", opts.status);
  }

  const { data, error } = (await query.order("local_ref", {
    ascending: true,
  })) as unknown as QueryResult;

  if (error) throw new Error(`fetchImportCandidates: ${error.message}`);
  return (data ?? []).map(parseCandidateRow);
}

/** Hent alle ubehandlede kandidater for en bruker — arbeidskøen i gjennomgangen. */
export async function fetchPendingCandidates(
  supabase: SupabaseLike,
  user_id: string,
): Promise<CvParseCandidate[]> {
  const { data, error } = (await table(supabase)
    .select("*")
    .eq("user_id", user_id)
    .eq("status", "ubehandlet")
    .order("created_at", { ascending: true })) as unknown as QueryResult;

  if (error) throw new Error(`fetchPendingCandidates: ${error.message}`);
  return (data ?? []).map(parseCandidateRow);
}

/** Hent kandidatene som henger under en gitt rolle-kandidat i samme import. */
export async function fetchChildCandidates(
  supabase: SupabaseLike,
  import_id: string,
  parent_local_ref: string,
): Promise<CvParseCandidate[]> {
  const { data, error } = (await table(supabase)
    .select("*")
    .eq("import_id", import_id)
    .eq("parent_local_ref", parent_local_ref)) as unknown as QueryResult;

  if (error) throw new Error(`fetchChildCandidates: ${error.message}`);
  return (data ?? []).map(parseCandidateRow);
}

/** Grupper kandidatene på den typen de faktisk skal bli (resolved ?? suggested). */
export function groupByEffectiveType(
  candidates: CvParseCandidate[],
): Record<AtomType, CvParseCandidate[]> {
  const grouped: Partial<Record<AtomType, CvParseCandidate[]>> = {};
  for (const c of candidates) {
    const t = (c.resolved_atom_type ?? c.suggested_atom_type) as AtomType;
    grouped[t] ??= [];
    grouped[t]!.push(c);
  }
  return grouped as Record<AtomType, CvParseCandidate[]>;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export interface InsertResult {
  inserted: CvParseCandidate[];
  rejected: { candidate: CandidateInsert; error: string }[];
}

/**
 * Sett inn kandidater etter validering. Avviste rader kommer tilbake med
 * feilmelding — de skal aldri forsvinne stille; caller må rapportere dem.
 */
export async function insertCandidates(
  supabase: SupabaseLike,
  candidates: CandidateInsert[],
): Promise<InsertResult> {
  const valid: CandidateInsert[] = [];
  const rejected: { candidate: CandidateInsert; error: string }[] = [];

  const seenRefs = new Set<string>();
  for (const candidate of candidates) {
    const result: ValidationResult = validateCandidate(candidate);
    if (!result.ok) {
      rejected.push({ candidate, error: result.error ?? "ukjent valideringsfeil" });
      continue;
    }
    const refKey = `${candidate.import_id}::${candidate.local_ref}`;
    if (seenRefs.has(refKey)) {
      rejected.push({ candidate, error: `duplikat local_ref: ${candidate.local_ref}` });
      continue;
    }
    seenRefs.add(refKey);
    valid.push(candidate);
  }

  if (valid.length === 0) {
    return { inserted: [], rejected };
  }

  const { data, error } = (await table(supabase)
    .insert(valid)
    .select()) as unknown as QueryResult;

  if (error) {
    return {
      inserted: [],
      rejected: [
        ...rejected,
        ...valid.map((c) => ({ candidate: c, error: `DB: ${error.message}` })),
      ],
    };
  }

  return { inserted: (data ?? []).map(parseCandidateRow), rejected };
}

/** Oppdater en kandidat (f.eks. brukerens korrigering av type). */
export async function updateCandidate(
  supabase: SupabaseLike,
  id: string,
  patch: Partial<CvParseCandidate>,
): Promise<CvParseCandidate> {
  const { data, error } = (await table(supabase)
    .update(patch)
    .eq("id", id)
    .select()) as unknown as QueryResult;

  if (error) throw new Error(`updateCandidate: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`updateCandidate: kandidat ${id} ikke funnet`);
  }
  return parseCandidateRow(data[0]);
}

/**
 * Brukeren bekreftet kandidaten, og den er promotert til et career_atom.
 * `promoted_atom_id` er påkrevd: en bekreftet kandidat uten atom er et brudd
 * på evidensprinsippet og skal ikke kunne oppstå.
 */
export async function markCandidateConfirmed(
  supabase: SupabaseLike,
  id: string,
  promoted_atom_id: string,
  resolved_atom_type?: AtomType,
): Promise<CvParseCandidate> {
  return updateCandidate(supabase, id, {
    status: "bekreftet",
    promoted_atom_id,
    ...(resolved_atom_type ? { resolved_atom_type } : {}),
    reviewed_at: new Date().toISOString(),
  } as Partial<CvParseCandidate>);
}

/** Brukeren avviste kandidaten. Grunnen lagres — den er læringsdata. */
export async function markCandidateRejected(
  supabase: SupabaseLike,
  id: string,
  rejected_reason: string | null = null,
): Promise<CvParseCandidate> {
  return updateCandidate(supabase, id, {
    status: "avvist",
    rejected_reason,
    reviewed_at: new Date().toISOString(),
  } as Partial<CvParseCandidate>);
}

/**
 * Kandidaten kunne ikke belegges (typisk: kompetanse uten evidens) og ble
 * gjort om til et spørsmål til brukeren.
 */
export async function markCandidateAsQuestion(
  supabase: SupabaseLike,
  id: string,
  question_ref: string,
): Promise<CvParseCandidate> {
  return updateCandidate(supabase, id, {
    status: "ble_sporsmal",
    question_ref,
    reviewed_at: new Date().toISOString(),
  } as Partial<CvParseCandidate>);
}

/** Slett en kandidat. Rører ikke career_atoms. */
export async function deleteCandidate(
  supabase: SupabaseLike,
  id: string,
): Promise<void> {
  const { error } = (await table(supabase)
    .delete()
    .eq("id", id)) as unknown as QueryResult;

  if (error) throw new Error(`deleteCandidate: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Korrigeringsrate — måltallet som avgjør om kategorikartet skal endres
// ---------------------------------------------------------------------------

export interface CorrectionRate {
  reviewed: number;
  corrected: number;
  rate: number;
  by_suggested_type: Record<string, { reviewed: number; corrected: number }>;
}

/** Regn ut hvor ofte brukeren måtte overstyre parserens forslag. */
export function computeCorrectionRate(
  candidates: CvParseCandidate[],
): CorrectionRate {
  const by: Record<string, { reviewed: number; corrected: number }> = {};
  let reviewed = 0;
  let corrected = 0;

  for (const c of candidates) {
    if (c.status === "ubehandlet") continue;
    reviewed++;
    const key = c.suggested_from_category ?? c.suggested_atom_type;
    by[key] ??= { reviewed: 0, corrected: 0 };
    by[key].reviewed++;
    if (c.resolved_atom_type && c.resolved_atom_type !== c.suggested_atom_type) {
      corrected++;
      by[key].corrected++;
    }
  }

  return {
    reviewed,
    corrected,
    rate: reviewed === 0 ? 0 : corrected / reviewed,
    by_suggested_type: by,
  };
}
