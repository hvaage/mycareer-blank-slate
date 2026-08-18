// @ts-nocheck
/**
 * Min dokumentasjon leser samme grunnlag som Karriereoversikt: bekreftede
 * `career_atoms`. Ingen egen kopi av resultater eller kompetanser — én
 * opplysning, ett sted.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ATOM_TYPE_CLASS } from "@/lib/queries/cv-parse-candidates";

export type DocAtomRow = {
  id: string;
  content_no: string | null;
  atom_type: string | null;
  atom_class: string | null;
  parent_atom_id: string | null;
  evidence_atom_ids: string[] | null;
  attestation: string | null;
  source_type: string | null;
  source_quote: string | null;
  structured_data: Record<string, unknown> | null;
  created_at: string | null;
};

export type DocRoleLabel = { id: string; label: string };

export type DocumentationAtomBasis = {
  roles: DocAtomRow[];
  results: DocAtomRow[];
  skills: DocAtomRow[];
  exposure: DocAtomRow[];
  qualifications: DocAtomRow[];
  roleLabelById: Record<string, string>;
};

export const documentationAtomKeys = {
  basis: (userId: string) => ["documentation", "career-atom-basis", userId] as const,
};

function sd(row: DocAtomRow): Record<string, any> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

export function docRoleLabel(row: DocAtomRow): string {
  const d = sd(row);
  const employer = d.employer ?? d.organization ?? d.company ?? null;
  const from = d.start_date ?? d.from ?? null;
  const to = d.end_date ?? d.to ?? null;
  const y = (v: any) => (v ? String(v).slice(0, 4) : null);
  const period = from || to ? `${y(from) ?? "?"}–${y(to) ?? "nå"}` : null;
  const title =
    (typeof d.title === "string" && d.title.trim()) || (row.content_no ?? "").trim() || "Rolle";
  return [title, employer, period].filter(Boolean).join(" · ");
}

function classOf(row: DocAtomRow): string | null {
  return (row.atom_class as string | null) ?? ATOM_TYPE_CLASS[row.atom_type as never] ?? null;
}

export const documentationAtomBasisQuery = (userId: string) =>
  queryOptions({
    queryKey: documentationAtomKeys.basis(userId),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<DocumentationAtomBasis> => {
      const { data, error } = await supabase
        .from("career_atoms")
        .select(
          "id, content_no, atom_type, atom_class, parent_atom_id, evidence_atom_ids, attestation, source_type, source_quote, structured_data, created_at",
        )
        .eq("user_id", userId)
        .eq("atom_kind", "evidens")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as DocAtomRow[];
      const roles = rows.filter((r) => r.atom_type === "role");
      const byClass = (c: string) => rows.filter((r) => r.atom_type !== "role" && classOf(r) === c);

      const roleLabelById: Record<string, string> = {};
      for (const r of roles) roleLabelById[r.id] = docRoleLabel(r);

      return {
        roles,
        results: byClass("resultat"),
        skills: byClass("kompetanse"),
        exposure: byClass("eksponering"),
        qualifications: byClass("kvalifikasjon"),
        roleLabelById,
      };
    },
  });
