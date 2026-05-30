import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export const applicationsListQuery = () =>
  queryOptions({
    queryKey: ["applications", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications_with_urgency")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const applicationsGeneratedNotSentQuery = () =>
  queryOptions({
    queryKey: ["applications", "søknad_generert_light"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, company_name, role_title, priority, status")
        .eq("status", "søknad_generert")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const applicationByIdQuery = (id: string) =>
  queryOptions({
    queryKey: ["applications", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export async function createApplication(input: TablesInsert<"applications">) {
  const { data, error } = await supabase.from("applications").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateApplication(id: string, input: TablesUpdate<"applications">) {
  const { data, error } = await supabase
    .from("applications")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteApplication(id: string) {
  const { error } = await supabase.from("applications").delete().eq("id", id);
  if (error) throw error;
}
