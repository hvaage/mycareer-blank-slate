// @ts-nocheck
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GENERATED_STATUSES = [
  "søknad_generert",
  "søknad_sendt",
  "screening",
  "intervju_1",
  "intervju_2",
  "intervju_3",
  "intervju_4",
  "case_study",
  "candidate_profiling",
  "tilbud_mottatt",
] as const;

export const generatedApplicationsListQuery = () =>
  queryOptions({
    queryKey: ["applications", "generated"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(`
          *,
          documents (
            id,
            title,
            document_type,
            content_text,
            created_at
          )
        `)
        .in("status", [...GENERATED_STATUSES])
        .order("letter_generated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
