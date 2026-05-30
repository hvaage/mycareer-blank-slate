import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GeneratedCvRow = {
  id: string;
  title: string;
  file_path: string | null;
  file_name: string | null;
  render_language: string | null;
  version: number | null;
  created_at: string;
  application_id: string | null;
  company_name: string | null;
};

export type TailoredCvRow = GeneratedCvRow & {
  applications: { company_name: string | null; role_title: string | null } | null;
};

export function useGeneratedGeneralCvs(userId: string | undefined) {
  return useQuery({
    queryKey: ["generated-cvs", "general", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, file_path, file_name, render_language, version, created_at, application_id, company_name")
        .eq("user_id", userId!)
        .eq("document_type", "cv")
        .is("application_id", null)
        .order("version", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as GeneratedCvRow[];
    },
  });
}

export function useGeneratedTailoredCvs(userId: string | undefined) {
  return useQuery({
    queryKey: ["generated-cvs", "tailored", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id, title, file_path, file_name, render_language, version, created_at, application_id, company_name, applications(company_name, role_title)",
        )
        .eq("user_id", userId!)
        .eq("document_type", "cv")
        .not("application_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TailoredCvRow[];
    },
  });
}

export async function downloadDocument(filePath: string) {
  const { data, error } = await supabase.storage
    .from("job-documents")
    .createSignedUrl(filePath, 60);
  if (error || !data) throw error ?? new Error("Kunne ikke åpne fil");
  window.open(data.signedUrl, "_blank");
}
