/**
 * 5b — handlinger på grunnlaget: redigering, sletting med konsekvensoppslag og bekreftelse.
 * Konsekvensoppslaget er en grafspørring i basen (`career_atom_delete_impact`), ikke en
 * opptelling i klienten. Ukjent eller fremmed id gir tom struktur, ikke feil.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";
import { invalidateUserAtomQueries } from "@/lib/queries/career-atoms";

export type CareerAtomRow = Tables<"career_atoms">;

export type ImpactAtom = {
  id: string;
  content_no: string | null;
  atom_kind: string;
  atom_type: string | null;
  atom_class: string | null;
  depth?: number;
  links_total?: number;
  links_lost?: number;
};

export type DeleteImpact = {
  found: boolean;
  atom: ImpactAtom | null;
  descendants: ImpactAtom[];
  /** Mister alt belegg og fjernes sammen med elementet. */
  orphaned: ImpactAtom[];
  /** Mister ett av flere belegg, men blir stående. */
  weakened: ImpactAtom[];
  parse_candidates: number;
};

export const EMPTY_IMPACT: DeleteImpact = {
  found: false,
  atom: null,
  descendants: [],
  orphaned: [],
  weakened: [],
  parse_candidates: 0,
};

function normalizeImpact(raw: unknown): DeleteImpact {
  if (!raw || typeof raw !== "object") return EMPTY_IMPACT;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): ImpactAtom[] => (Array.isArray(v) ? (v as ImpactAtom[]) : []);
  return {
    found: r["found"] === true,
    atom: (r["atom"] as ImpactAtom | null) ?? null,
    descendants: list(r["descendants"]),
    orphaned: list(r["orphaned"]),
    weakened: list(r["weakened"]),
    parse_candidates: Number(r["parse_candidates"] ?? 0) || 0,
  };
}

export async function fetchDeleteImpact(atomId: string): Promise<DeleteImpact> {
  const { data, error } = await supabase.rpc("career_atom_delete_impact" as never, {
    p_atom_id: atomId,
  } as never);
  if (error) throw error;
  return normalizeImpact(data);
}

export const deleteImpactQuery = (atomId: string) =>
  queryOptions({
    queryKey: ["career-atom-delete-impact", atomId],
    staleTime: 0,
    queryFn: () => fetchDeleteImpact(atomId),
  });

export type DeleteResult = {
  found: boolean;
  deleted: number;
  unlinked: number;
  orphaned: number;
};

export async function deleteCareerAtom(atomId: string): Promise<DeleteResult> {
  const { data, error } = await supabase.rpc("career_atom_delete" as never, {
    p_atom_id: atomId,
  } as never);
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    found: r["found"] === true,
    deleted: Number(r["deleted"] ?? 0) || 0,
    unlinked: Number(r["unlinked"] ?? 0) || 0,
    orphaned: Number(r["orphaned"] ?? 0) || 0,
  };
}

export type EditAtomPayload = {
  /** Selve påstanden slik den vises. */
  content_no: string;
  /** Utdypning: hva som faktisk skjedde. */
  beskrivelse?: string | null;
  /** Kun roller. */
  employer?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function structuredOf(row: CareerAtomRow): Record<string, unknown> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/**
 * Redigering endrer innholdet brukeren har skrevet, og teller som en bekreftelse:
 * han har nettopp sett på påstanden og stått for den.
 */
export async function updateCareerAtom(
  userId: string,
  row: CareerAtomRow,
  payload: EditAtomPayload,
): Promise<void> {
  const label = payload.content_no.trim();
  if (!label) throw new Error("Teksten kan ikke være tom.");
  const beskrivelse = payload.beskrivelse?.trim() || null;
  const structured = structuredOf(row);
  structured["etikett"] = label;
  structured["beskrivelse"] = beskrivelse;
  if (row.atom_type === "role") {
    structured["employer"] = payload.employer?.trim() || null;
    structured["start_date"] = payload.start_date?.trim() || null;
    structured["end_date"] = payload.end_date?.trim() || null;
  }
  structured["edited_by_user_at"] = new Date().toISOString();

  const patch: TablesUpdate<"career_atoms"> = {
    content_no: label,
    source_quote: beskrivelse,
    structured_data: structured as Json,
    user_confirmed: true,
    user_locked: true,
    refreshed_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("career_atoms")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Bekreftelse uten endring: «dette stemmer fortsatt». */
export async function confirmCareerAtom(userId: string, atomId: string): Promise<void> {
  const { error } = await supabase
    .from("career_atoms")
    .update({ user_confirmed: true, refreshed_at: new Date().toISOString() })
    .eq("id", atomId)
    .eq("user_id", userId);
  if (error) throw error;
}

export function invalidateAfterAtomChange(queryClient: QueryClient, userId: string): void {
  invalidateUserAtomQueries(queryClient, userId);
  void queryClient.invalidateQueries({ queryKey: ["career-atom-delete-impact"] });
}
