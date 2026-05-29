// cv-evidence-graph — Supabase CRUD wrappers
// Tynne wrappers rundt Supabase-spørringer for cv_evidence_atoms-tabellen.
// Bruker generic Supabase client-type for å fungere både i Edge-funksjon og frontend.

import type {
  CvAtom,
  AtomInsert,
  AtomType,
} from "./types.ts";
import { parseAtomRow } from "./types.ts";
import { validateAtom, type ValidationResult } from "./validators.ts";

// ---------------------------------------------------------------------------
// Generic Supabase client interface — fungerer med både @supabase/supabase-js
// og Deno-versjonene. Edge-funksjoner sender service-role-klient,
// frontend sender bruker-scoped klient.
// ---------------------------------------------------------------------------

type SupabaseLike = {
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (column: string, value: unknown) => {
        eq?: (column: string, value: unknown) => unknown;
        in?: (column: string, values: unknown[]) => unknown;
        order?: (column: string, opts?: { ascending?: boolean }) => unknown;
      };
      in?: (column: string, values: unknown[]) => unknown;
      order?: (column: string, opts?: { ascending?: boolean }) => unknown;
    };
    insert: (rows: unknown) => {
      select: () => unknown;
    };
    update: (row: unknown) => {
      eq: (column: string, value: unknown) => unknown;
    };
    delete: () => {
      eq: (column: string, value: unknown) => unknown;
    };
  };
};

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Hent alle atoms for en bruker. Default: kun confirmed atoms.
 */
export async function fetchUserAtoms(
  supabase: SupabaseLike,
  user_id: string,
  opts: { onlyConfirmed?: boolean; types?: AtomType[] } = {},
): Promise<CvAtom[]> {
  const onlyConfirmed = opts.onlyConfirmed ?? true;

  let query = (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: unknown) => unknown;
      };
    };
  }).from("cv_evidence_atoms").select("*").eq("user_id", user_id);

  if (onlyConfirmed) {
    query = (query as { eq: (col: string, v: unknown) => unknown }).eq(
      "user_confirmed",
      true,
    );
  }

  if (opts.types && opts.types.length > 0) {
    query = (query as { in: (col: string, v: unknown[]) => unknown }).in(
      "atom_type",
      opts.types,
    );
  }

  const { data, error } = (await query) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(`fetchUserAtoms: ${error.message}`);
  return (data ?? []).map(parseAtomRow);
}

/**
 * Hent atoms for en spesifikk parent (f.eks. alle achievements under en role).
 */
export async function fetchChildAtoms(
  supabase: SupabaseLike,
  parent_atom_id: string,
): Promise<CvAtom[]> {
  const { data, error } = (await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: unknown) => unknown;
      };
    };
  })
    .from("cv_evidence_atoms")
    .select("*")
    .eq("parent_atom_id", parent_atom_id)) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(`fetchChildAtoms: ${error.message}`);
  return (data ?? []).map(parseAtomRow);
}

/**
 * Hent atoms gruppert etter type for hurtig oppslag i UI eller komposisjon.
 */
export async function fetchAtomsGroupedByType(
  supabase: SupabaseLike,
  user_id: string,
  opts: { onlyConfirmed?: boolean } = {},
): Promise<Record<AtomType, CvAtom[]>> {
  const all = await fetchUserAtoms(supabase, user_id, opts);
  const grouped: Partial<Record<AtomType, CvAtom[]>> = {};
  for (const atom of all) {
    grouped[atom.atom_type] ??= [];
    grouped[atom.atom_type]!.push(atom);
  }
  return grouped as Record<AtomType, CvAtom[]>;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export interface InsertResult {
  inserted: CvAtom[];
  rejected: { atom: AtomInsert; error: string }[];
}

/**
 * Sett inn atoms etter validering. Avvist atoms kommer tilbake med feilmelding.
 * Caller må bestemme hva som skal skje med rejected (logge, vise i UI, eller stoppe).
 */
export async function insertAtoms(
  supabase: SupabaseLike,
  atoms: AtomInsert[],
): Promise<InsertResult> {
  const valid: AtomInsert[] = [];
  const rejected: { atom: AtomInsert; error: string }[] = [];

  for (const atom of atoms) {
    const result: ValidationResult = validateAtom(atom);
    if (result.ok) {
      valid.push(atom);
    } else {
      rejected.push({ atom, error: result.error ?? "ukjent validation-feil" });
    }
  }

  if (valid.length === 0) {
    return { inserted: [], rejected };
  }

  const { data, error } = (await (supabase as unknown as {
    from: (t: string) => {
      insert: (rows: unknown) => { select: () => unknown };
    };
  })
    .from("cv_evidence_atoms")
    .insert(valid)
    .select()) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error) {
    // DB-feil: returner alle som rejected
    return {
      inserted: [],
      rejected: [
        ...rejected,
        ...valid.map((a) => ({ atom: a, error: `DB: ${error.message}` })),
      ],
    };
  }

  return {
    inserted: (data ?? []).map(parseAtomRow),
    rejected,
  };
}

/**
 * Sett inn et atom-tre i riktig rekkefølge: parent først, så children.
 * Brukes for import: en role + dets achievements + dets metrics.
 */
export async function insertAtomTree(
  supabase: SupabaseLike,
  parent: AtomInsert,
  children: AtomInsert[],
): Promise<{ parent: CvAtom; children: CvAtom[] }> {
  // Sett inn parent først for å få ID
  const parentResult = await insertAtoms(supabase, [parent]);
  if (parentResult.inserted.length === 0) {
    throw new Error(
      `insertAtomTree: parent rejected: ${parentResult.rejected[0]?.error ?? "ukjent"}`,
    );
  }
  const parentAtom = parentResult.inserted[0];

  // Oppdater children med riktig parent_atom_id
  const childrenWithParent = children.map((c) => ({
    ...c,
    parent_atom_id: parentAtom.id,
  }));

  const childResult = await insertAtoms(supabase, childrenWithParent);
  return { parent: parentAtom, children: childResult.inserted };
}

/**
 * Oppdater et atom. Bruk for endringer fra editor eller etter dedup-merge.
 */
export async function updateAtom(
  supabase: SupabaseLike,
  id: string,
  patch: Partial<CvAtom>,
): Promise<CvAtom> {
  const { data, error } = (await (supabase as unknown as {
    from: (t: string) => {
      update: (row: unknown) => {
        eq: (col: string, v: unknown) => unknown;
      };
    };
  })
    .from("cv_evidence_atoms")
    .update(patch)
    .eq("id", id)) as {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(`updateAtom: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`updateAtom: atom ${id} ikke funnet`);
  return parseAtomRow(data[0]);
}

/**
 * Bekreft et atom — sett user_confirmed=true og confidence='verified'.
 */
export async function confirmAtom(
  supabase: SupabaseLike,
  id: string,
): Promise<CvAtom> {
  return updateAtom(supabase, id, {
    user_confirmed: true,
    confidence: "verified",
  });
}

/**
 * Bekreft flere atoms i batch. Brukes etter import-review-steget.
 */
export async function confirmAtoms(
  supabase: SupabaseLike,
  ids: string[],
): Promise<{ confirmed: number; failed: { id: string; error: string }[] }> {
  let confirmed = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await confirmAtom(supabase, id);
      confirmed++;
    } catch (e) {
      failed.push({ id, error: (e as Error).message });
    }
  }
  return { confirmed, failed };
}

/**
 * Lås et atom — brukeren har endret ordlyden manuelt og vil ikke at AI skal omformulere.
 */
export async function lockAtom(
  supabase: SupabaseLike,
  id: string,
): Promise<CvAtom> {
  return updateAtom(supabase, id, { user_locked: true });
}

/**
 * Slett et atom. Cascade-delete håndterer children (definert i migration).
 */
export async function deleteAtom(
  supabase: SupabaseLike,
  id: string,
): Promise<void> {
  const { error } = (await (supabase as unknown as {
    from: (t: string) => {
      delete: () => { eq: (col: string, v: unknown) => unknown };
    };
  })
    .from("cv_evidence_atoms")
    .delete()
    .eq("id", id)) as { error: { message: string } | null };

  if (error) throw new Error(`deleteAtom: ${error.message}`);
}
