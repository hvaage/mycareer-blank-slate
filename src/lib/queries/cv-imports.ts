import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";
import { supabase } from "@/lib/supabase";
import type {
  CommitResponse,
  CvImportRow,
  ParseResponse,
  PreviewCounts,
  RegisterUploadResponse,
} from "@/types/cv-upload";

/**
 * Sant bare når svaret har minst én av de forventede listene. Et parse-resultat
 * uten noen av dem er ikke «en tom CV», det er et svar vi ikke klarte å lese —
 * og de to skal aldri se like ut for brukeren.
 */
export function parsedShapeIsReadable(raw: any): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = [
    "experience",
    "work_experience",
    "education",
    "skills",
    "languages",
    "certifications",
    "projects",
    "achievements",
    "awards",
  ];
  return keys.some((k) => Array.isArray(raw[k]));
}

export function countsFromParsed(raw: any): PreviewCounts {
  const c = (k: string) => (Array.isArray(raw?.[k]) ? raw[k].length : 0);
  const experienceRows: any[] = [
    ...(Array.isArray(raw?.experience) ? raw.experience : []),
    ...(Array.isArray(raw?.work_experience) ? raw.work_experience : []),
  ];
  // Punktene under hver stilling er egne elementer — de ble tidligere ikke
  // talt med, så totalen så mindre ut enn det som faktisk ble lagret.
  const experienceBullets = experienceRows.reduce(
    (n, e) => n + (Array.isArray(e?.bullets) ? e.bullets.filter(Boolean).length : 0),
    0,
  );
  const volunteer = c("volunteer") + c("volunteering");
  const experience = c("experience") + c("work_experience");
  const education = c("education");
  const skills = c("skills");
  const languages = c("languages");
  const certifications = c("certifications");
  const projects = c("projects");
  const achievements = c("achievements") + c("awards");
  return {
    experience,
    experienceBullets,
    volunteer,
    education,
    skills,
    languages,
    certifications,
    projects,
    achievements,
    total:
      experience +
      experienceBullets +
      volunteer +
      education +
      skills +
      languages +
      certifications +
      projects +
      achievements,
  };
}

export function useUserImports(userId: string | undefined) {
  return useQuery({
    queryKey: ["cv-imports", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cv_imports")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CvImportRow[];
    },
  });
}

export function useUserAtomCounts(userId: string | undefined) {
  return useQuery({
    queryKey: ["cv-atom-counts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("career_atoms")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!)
        .eq("is_active", true);
      if (error) throw error;
      if (typeof count !== "number") {
        // Null telling er ikke «null atomer» — det er en telling vi ikke fikk.
        throw new Error("Kunne ikke telle elementene i karriereoversikten.");
      }
      return count;
    },
  });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const PARSE_INVOKE_MS = 180_000;

async function invokeParseWithTimeout(importId: string): Promise<ParseResponse> {
  const invokePromise = supabase.functions.invoke(
    "parse-uploaded-cv",
    { body: { import_id: importId } },
  ) as Promise<{ data: ParseResponse | null; error: Error | null }>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const err: any = new Error(
        "Tidsavbrudd under analyse (over 3 min). Prøv igjen med en mindre fil, eller prøv på nytt.",
      );
      err.code = "parse_failed";
      reject(err);
    }, PARSE_INVOKE_MS);
  });
  const res = (await Promise.race([invokePromise, timeoutPromise])) as Awaited<typeof invokePromise>;
  const data: ParseResponse | null = res.data;
  const error: Error | null = res.error as Error | null;
  if (error) {
    const ctx = (error as any).context;
    let code = "parse_failed";
    let message = error.message;
    let detaljerLest = false;
    try {
      const body = ctx ? await ctx.json() : null;
      if (body?.error) code = body.error;
      if (body?.message) message = body.message;
      detaljerLest = !!body;
    } catch (bodyErr) {
      console.warn("[cv-imports] Kunne ikke lese feilkroppen fra parse-uploaded-cv", bodyErr);
    }
    if (!detaljerLest) {
      // Brukeren skal ikke få en naken «non-2xx»-melding uten å vite at årsaken mangler.
      message = `${message} (vi fikk ikke lest årsaken fra tjenesten)`;
    }
    const err: any = new Error(normalizeAiErrorMessage(message, { kind: "generic" }));
    err.code = code;
    throw err;
  }
  if (!data) {
    const err: any = new Error("Tomt svar fra parse-uploaded-cv.");
    err.code = "parse_failed";
    throw err;
  }
  return data;
}

/** Storage upload + `cv_imports` row with status `pending` (AI-parse not started yet). */
export function useRegisterCvUpload(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<RegisterUploadResponse> => {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      const sourceFormat: "pdf" | "docx" = ext === "pdf" ? "pdf" : "docx";
      const safeName = sanitizeFilename(file.name);
      const path = `${userId}/${Date.now()}-${safeName}`;

      const uploadPromise = supabase.storage
        .from("cv-uploads")
        .upload(path, file, { contentType: file.type, upsert: false });
      const timeout = new Promise<{ error: Error }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              error: new Error(
                "Tidsavbrudd under opplasting (over 90 sek). Sjekk nettverket og prøv igjen.",
              ),
            }),
          90_000,
        ),
      );
      const { error: upErr } = (await Promise.race([uploadPromise, timeout])) as any;
      if (upErr) {
        const err: any = new Error(upErr.message);
        err.code = "upload_failed";
        throw err;
      }

      const importType = sourceFormat === "pdf" ? "old_cv_pdf" : "old_cv_docx";

      const { data: row, error: insErr } = await supabase
        .from("cv_imports")
        .insert({
          user_id: userId,
          import_type: importType,
          source_filename: file.name,
          source_file_path: path,
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
        source_filename: (row.source_filename as string) ?? file.name,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cv-imports", userId] });
    },
  });
}

/** Runs AI parse for an existing `cv_imports` row (`pending` or `failed`). */
export function useRunCvParse(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) => invokeParseWithTimeout(importId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cv-imports", userId] });
    },
  });
}

export function useCommitImport(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (importId: string): Promise<CommitResponse> => {
      const { data, error } = (await supabase.functions.invoke(
        "commit-cv-import",
        { body: { import_id: importId } },
      )) as { data: CommitResponse | null; error: Error | null };
      if (error) {
        const ctx = (error as any).context;
        let code = "database_error";
        let message = error.message;
        let detaljerLest = false;
        try {
          const body = ctx ? await ctx.json() : null;
          if (body?.error) code = body.error;
          if (body?.message) message = body.message;
          detaljerLest = !!body;
        } catch (bodyErr) {
          console.warn("[cv-imports] Kunne ikke lese feilkroppen fra commit-cv-import", bodyErr);
        }
        const err: any = new Error(
          detaljerLest ? message : `${message} (vi fikk ikke lest årsaken fra tjenesten)`,
        );
        err.code = code;
        throw err;
      }
      if (!data) {
        const err: any = new Error("Tomt svar fra commit-cv-import.");
        err.code = "database_error";
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cv-imports", userId] });
      qc.invalidateQueries({ queryKey: ["cv-atom-counts", userId] });
    },
  });
}

/**
 * Avbryter en import. Merk: statusen `failed` deles med ekte feil fordi
 * `cv_imports.status` ikke har en `cancelled`-verdi; `error_message` skiller dem.
 * Kaster ved feil — kallstedet må vise det, ellers ser en mislykket avbrytelse
 * ut som en vellykket.
 */
export async function cancelImport(importId: string) {
  const { error } = await (supabase.from("cv_imports") as any)
    .update({ status: "failed", error_message: "cancelled_by_user" })
    .eq("id", importId);
  if (error) throw error;
}
