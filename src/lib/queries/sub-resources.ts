// @ts-nocheck
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const stagesQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["stages", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("application_stages")
        .select("*")
        .eq("application_id", applicationId)
        .order("stage_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

export const documentsForApplicationQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["documents", "by-application", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const meetingNotesQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["meeting_notes", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_notes")
        .select("*")
        .eq("application_id", applicationId)
        .order("meeting_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const nextStepsQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["next_steps", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("next_steps")
        .select("*")
        .eq("application_id", applicationId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const candidateProfileQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["candidate_profile", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_profiles")
        .select("*")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const jobAdQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["job_ad", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_ads")
        .select("*")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const changeLogQuery = (applicationId: string) =>
  queryOptions({
    queryKey: ["change_log", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_log")
        .select("*")
        .eq("application_id", applicationId)
        .order("changed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

// Global queries
export const allDocumentsQuery = () =>
  queryOptions({
    queryKey: ["documents", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*, applications(company_name, role_title, applied_date, status)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

/** Columns needed by `/_authenticated/documents/$id` (avoid `select('*')`). */
const DOCUMENT_DETAIL_SELECT =
  "id, title, document_type, content_text, application_id, is_base_version, tailored_for, version, file_path, file_name, customization_notes, company_name";

export const documentByIdQuery = (id: string) => {
  const trimmed = typeof id === "string" ? id.trim() : "";
  const enabled = trimmed.length > 0;

  return queryOptions({
    queryKey: ["documents", trimmed],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select(DOCUMENT_DETAIL_SELECT)
        .eq("id", trimmed)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
};

export const allNextStepsQuery = () =>
  queryOptions({
    queryKey: ["next_steps", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("next_steps")
        .select("*, applications(company_name, role_title)")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const recentChangeLogQuery = () =>
  queryOptions({
    queryKey: ["change_log", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_log")
        .select("*, applications(company_name)")
        .order("changed_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
