// @ts-nocheck
/**
 * Lager utkast i «Min dokumentasjon» fra resultatpunktene i en CV-import.
 *
 * Dette er utkast, ikke evidens: radene får `verified = false` og må jobbes
 * videre med under /documentation. Ingenting promoteres til career_atoms her.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { documentationQueryKeys } from "@/lib/queries/documentation";

const db = supabase as any;

export type DocumentationDraftResult = {
  results_created: number;
  skipped_existing: number;
};

function titleFrom(text: string): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 87)}…`;
}

/**
 * Leser achievement-kandidatene i importen og skriver dem som resultat-utkast,
 * med rolle og arbeidsgiver som kontekst. Kaster ved feil — en stille
 * feilende «lag utkast» ville sett ut som at det ikke fantes noe å lage.
 */
export function useCreateDocumentationDrafts(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (importId: string): Promise<DocumentationDraftResult> => {
      const { data: candidates, error } = await db
        .from("cv_parse_candidates")
        .select("local_ref, parent_local_ref, suggested_atom_type, content_no, structured_data")
        .eq("import_id", importId)
        .eq("user_id", userId);
      if (error) throw error;

      const rows: any[] = candidates ?? [];
      const roleByRef = new Map<string, any>();
      for (const r of rows) {
        if (r.suggested_atom_type === "role") roleByRef.set(r.local_ref, r);
      }

      const achievements = rows.filter(
        (r) => r.suggested_atom_type === "achievement" || r.suggested_atom_type === "project",
      );
      if (achievements.length === 0) {
        return { results_created: 0, skipped_existing: 0 };
      }

      const { data: existing, error: exErr } = await db
        .from("professional_results")
        .select("title")
        .eq("user_id", userId);
      if (exErr) throw exErr;
      const existingTitles = new Set(
        (existing ?? []).map((r: any) => String(r.title ?? "").toLowerCase().trim()),
      );

      const inserts: any[] = [];
      let skipped = 0;
      for (const a of achievements) {
        const sd = (a.structured_data ?? {}) as Record<string, any>;
        const text = String(sd.what ?? a.content_no ?? "").trim();
        if (!text) continue;
        const title = titleFrom(text);
        if (existingTitles.has(title.toLowerCase().trim())) {
          skipped += 1;
          continue;
        }
        existingTitles.add(title.toLowerCase().trim());
        const parent = a.parent_local_ref ? roleByRef.get(a.parent_local_ref) : null;
        const psd = (parent?.structured_data ?? {}) as Record<string, any>;
        inserts.push({
          user_id: userId,
          title,
          description: text,
          company_name: psd.employer ?? null,
          role_context: psd.title ?? null,
          time_period:
            sd.date_period ??
            (psd.start_date
              ? `${psd.start_date}–${psd.end_date ?? "nå"}`
              : null),
          metric_name: sd.how_measured ?? null,
          metric_value: sd.result ?? null,
          verified: false,
        });
      }

      if (inserts.length === 0) {
        return { results_created: 0, skipped_existing: skipped };
      }

      const { data: created, error: insErr } = await db
        .from("professional_results")
        .insert(inserts)
        .select("id");
      if (insErr) throw insErr;

      return { results_created: (created ?? []).length, skipped_existing: skipped };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentationQueryKeys.professionalResults });
      qc.invalidateQueries({ queryKey: documentationQueryKeys.overviewCounts });
    },
  });
}
