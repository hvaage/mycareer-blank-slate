// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RegisterUploadResponse } from "@/types/cv-upload";

export type ArchivedCvSource = {
  key: string;
  /** "Egne CV-er (opplastet)" | "Generelle CV-er (generert)" | "Stillingstilpassede CV-er (generert)" */
  group: string;
  label: string;
  path: string;
  filename: string;
  updatedAt: string | null;
};

function extOf(path: string) {
  return (path.split(".").pop() ?? "").toLowerCase();
}

function supported(path: string | null | undefined): path is string {
  if (!path) return false;
  const ext = extOf(path);
  return ext === "pdf" || ext === "docx";
}

/**
 * Alle CV-filer som allerede ligger i arkivet (bucket `job-documents`) og som
 * analysen kan lese: egne opplastede, genererte generelle og stillingstilpassede.
 */
export function useArchivedCvSources(userId: string | undefined) {
  return useQuery({
    queryKey: ["archived-cv-sources", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ArchivedCvSource[]> => {
      const [profileRes, docsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "cv_no_word_path, cv_no_pdf_path, cv_en_word_path, cv_en_pdf_path, cv_no_updated_at, cv_en_updated_at",
          )
          .eq("id", userId!)
          .maybeSingle(),
        supabase
          .from("documents")
          .select(
            "id, title, file_path, file_name, render_language, version, created_at, application_id, company_name",
          )
          .eq("user_id", userId!)
          .eq("document_type", "cv")
          .order("created_at", { ascending: false }),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (docsRes.error) throw docsRes.error;

      const out: ArchivedCvSource[] = [];
      const p: any = profileRes.data ?? {};

      const ownSlots: Array<[string, string, string | null]> = [
        ["cv_no_word_path", "Norsk CV (Word)", p.cv_no_updated_at ?? null],
        ["cv_no_pdf_path", "Norsk CV (PDF)", p.cv_no_updated_at ?? null],
        ["cv_en_word_path", "Engelsk CV (Word)", p.cv_en_updated_at ?? null],
        ["cv_en_pdf_path", "Engelsk CV (PDF)", p.cv_en_updated_at ?? null],
      ];
      for (const [field, label, updatedAt] of ownSlots) {
        const path = p[field] as string | null;
        if (!supported(path)) continue;
        out.push({
          key: `profile:${field}`,
          group: "Egne CV-er (opplastet)",
          label,
          path,
          filename: path.split("/").pop() ?? label,
          updatedAt,
        });
      }

      for (const d of (docsRes.data ?? []) as any[]) {
        if (!supported(d.file_path)) continue;
        const tailored = !!d.application_id;
        out.push({
          key: `document:${d.id}`,
          group: tailored
            ? "Stillingstilpassede CV-er (generert)"
            : "Generelle CV-er (generert)",
          label:
            [d.title, d.company_name, d.version ? `v${d.version}` : null]
              .filter(Boolean)
              .join(" · ") || (d.file_name ?? "CV"),
          path: d.file_path,
          filename: d.file_name ?? (d.file_path.split("/").pop() as string),
          updatedAt: d.created_at ?? null,
        });
      }

      return out;
    },
  });
}

/**
 * Kopierer en arkivfil inn i analyse-bucketen og oppretter en `cv_imports`-rad
 * med status `pending`. Selve AI-analysen startes separat, som ved opplasting.
 */
export function useImportArchivedCv(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (source: ArchivedCvSource): Promise<RegisterUploadResponse> => {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("job-documents")
        .download(source.path);
      if (dlErr || !blob) {
        const err: any = new Error(
          dlErr?.message ?? "Kunne ikke hente filen fra CV-arkivet.",
        );
        err.code = "upload_failed";
        throw err;
      }

      const ext = extOf(source.path) === "pdf" ? "pdf" : "docx";
      const safeName = source.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const destPath = `${userId}/${Date.now()}-arkiv-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("cv-uploads")
        .upload(destPath, blob, {
          contentType:
            ext === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: false,
        });
      if (upErr) {
        const err: any = new Error(upErr.message);
        err.code = "upload_failed";
        throw err;
      }

      const { data: row, error: insErr } = await supabase
        .from("cv_imports")
        .insert({
          user_id: userId,
          import_type: ext === "pdf" ? "old_cv_pdf" : "old_cv_docx",
          source_filename: source.filename,
          source_file_path: destPath,
          status: "pending",
          started_at: new Date().toISOString(),
        })
        .select("id, source_file_path, source_filename")
        .single();

      if (insErr || !row) {
        const err: any = new Error(insErr?.message ?? "Kunne ikke opprette import-rad.");
        err.code = "database_error";
        throw err;
      }

      return {
        import_id: row.id as string,
        status: "pending",
        source_file_path: row.source_file_path as string,
        source_filename: (row.source_filename as string) ?? source.filename,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cv-imports", userId] });
    },
  });
}
