import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminIngestionRegnskapRun = {
  id?: string | null;
  status?: string | null;
  mode?: string | null;
  selected_count?: number | null;
  checked_count?: number | null;
  with_regnskap_count?: number | null;
  no_regnskap_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
  records_lagret?: number | null;
  duration_ms?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  last_error?: string | null;
};

export type AdminIngestionNavRun = {
  id?: string | null;
  mode?: string | null;
  fetched?: number | null;
  upserted?: number | null;
  expired?: number | null;
  reactivated?: number | null;
  matched_user_opps?: number | null;
  scored?: number | null;
  noop?: number | null;
  stale?: number | null;
  error_summary?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type AdminIngestionDaily = {
  date: string;
  new_unique_postings?: number | null;
  inserted_rows?: number | null;
};

export type AdminIngestionStatus = {
  generated_at: string;
  timezone: string;
  window: { days: number; from_date: string; to_date: string };
  brreg: {
    enhetsregisteret: {
      downloaded_total?: number | null;
      downloaded_active?: number | null;
      downloaded_deleted?: number | null;
      latest_fetched_at?: string | null;
      latest_updated_at?: string | null;
      remaining_upstream?: number | null;
      remaining_reason?: string | null;
    };
    regnskapsregisteret: {
      rows_total?: number | null;
      companies_with_min_1_year?: number | null;
      companies_with_min_1_year_in_enhetsregisteret?: number | null;
      latest_regnskapsaar?: number | string | null;
      latest_fetched_at?: string | null;
      remaining_against_local_enhetsregisteret?: number | null;
      remaining_estimate_kind?: string | null;
      remaining_explanation?: string | null;
    };
    regnskap_sync: {
      due_now_estimate?: number | null;
      by_status?: Record<string, number> | null;
      failed_or_retry?: number | null;
      in_progress?: number | null;
      in_progress_stuck?: number | null;
      latest_run?: AdminIngestionRegnskapRun | null;
    };
  };
  nav: {
    active_unique_postings?: number | null;
    new_unique_postings_window?: number | null;
    daily_new_unique_postings?: AdminIngestionDaily[] | null;
    latest_run?: AdminIngestionNavRun | null;
    daily_definition?: string | null;
    latest_source_posting_created_at?: string | null;
    latest_source_posting_seen_at?: string | null;
  };
};

export const getAdminIngestionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as {
      supabase: {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    const { data, error } = await supabase.rpc("get_admin_ingestion_status", {
      p_days: 14,
      p_timezone: "Europe/Oslo",
    });
    if (error) throw new Error(error.message);
    return data as AdminIngestionStatus;
  });
