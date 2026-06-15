/**
 * Typed wrapper rundt Supabase-kallene for Arbeidsgiverinnsikt.
 *
 * Bakgrunn: `search_employers` (RPC) og `employer_search_v1` (view) finnes
 * ikke i de genererte Supabase-typene ennå. Vi kapsler alle casts her, og
 * eksponerer rene typede data utad. Komponenter skal IKKE caste selv.
 *
 * Frontend skal aldri SELECT direkte mot `reg.*`. Hvis RPC/view mangler
 * eller mangler anon access → vis empty/error state. Ingen workarounds.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------- Felles types ----------

export type EmployerSearchFilters = {
  q?: string;
  fylke?: string;
  kommune?: string;
  nace?: string;
  ansatteMin?: number;
  ansatteMaks?: number;
  omsMin?: number;
  omsMaks?: number;
  type?: string;
  page: number;
  pageSize: number;
};

/**
 * Felt vi forventer fra `search_employers` RPC. Alt er optional — UI tåler
 * at backend ikke leverer feltet ennå.
 */
export type EmployerSearchRow = {
  organisasjonsnummer: string;
  navn: string;
  fylkesnummer?: string | null;
  fylke_navn?: string | null;
  kommunenummer?: string | null;
  kommune_navn?: string | null;
  naeringskode?: string | null;
  bransje?: string | null;
  antall_ansatte?: number | null;
  ansatte_bucket?: string | null;
  driftsinntekter?: number | null;
  omsetning_bucket?: string | null;
  driftsmargin_prosent?: number | null;
  egenkapitalandel_prosent?: number | null;
  arbeidsgiver_type?: string | null;
  risiko_flags?: string[] | null;
  datakvalitet_flags?: string[] | null;
};

export type EmployerSearchResult = {
  rows: EmployerSearchRow[];
  totalCount: number | null;
  available: boolean; // false = RPC mangler / ikke konfigurert
  errorMessage: string | null;
};

/**
 * Felt vi forventer fra `employer_search_v1` view. Alt er optional — felt
 * som `agg_process_*`, `research_log`, `epostadresse`, `telefon`, `mobil`
 * kan komme senere. UI viser tomtilstand når de mangler.
 */
export type EmployerDetail = {
  organisasjonsnummer: string;
  navn: string;
  // Sted
  fylkesnummer?: string | null;
  fylke_navn?: string | null;
  kommunenummer?: string | null;
  kommune_navn?: string | null;
  // Register
  organisasjonsform?: string | null;
  naeringskode?: string | null;
  naeringskoder?: string[] | null;
  bransje?: string | null;
  stiftelsesdato?: string | null;
  mva_registrert?: boolean | null;
  arbeidsgiver_type?: string | null;
  overordnet_enhet?: string | null;
  konsern?: string | null;
  hjemmeside?: string | null;
  epostadresse?: string | null;
  telefon?: string | null;
  mobil?: string | null;
  // Regnskap — siste tilgjengelige år
  regnskapsaar?: number | null;
  driftsinntekter?: number | null;
  driftsresultat?: number | null;
  aarsresultat?: number | null;
  egenkapital?: number | null;
  gjeld?: number | null;
  eiendeler?: number | null;
  driftsmargin_prosent?: number | null;
  egenkapitalandel_prosent?: number | null;
  gjeldsgrad?: number | null;
  antall_ansatte?: number | null;
  ansatte_bucket?: string | null;
  omsetning_bucket?: string | null;
  // Eksisterende 6-dim AI-vurdering
  ai_culture_score?: number | null;
  ai_leadership_score?: number | null;
  ai_work_environment_score?: number | null;
  ai_career_development_score?: number | null;
  ai_financial_stability_score?: number | null;
  ai_mission_score?: number | null;
  ai_overall_score?: number | null;
  ai_rating_notes?: string | null;
  ai_dimension_notes?: string | null;
  // Aggregerte ansattvurderinger
  agg_culture_score?: number | null;
  agg_leadership_score?: number | null;
  agg_work_environment_score?: number | null;
  agg_career_development_score?: number | null;
  agg_financial_stability_score?: number | null;
  agg_mission_score?: number | null;
  agg_overall_score?: number | null;
  agg_rating_count?: number | null;
  // Aggregerte søkervurderinger (optional — kan komme senere)
  agg_process_overall?: number | null;
  agg_process_count?: number | null;
  agg_process_q1?: number | null;
  agg_process_q2?: number | null;
  agg_process_q3?: number | null;
  agg_process_q4?: number | null;
  agg_process_q5?: number | null;
  agg_process_q6?: number | null;
  // Kilder og datakvalitet
  regnskap_sync_status?: string | null;
  regnskap_last_checked_at?: string | null;
  research_log?: unknown;
  risiko_flags?: string[] | null;
  datakvalitet_flags?: string[] | null;
};

// ---------- Internal helpers (eneste sted vi caster) ----------

type AnySupabase = {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (name: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

const sb = supabase as unknown as AnySupabase;

function isMissingRpcOrView(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" || e.code === "42P01") {
    return true;
  }
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("function") && msg.includes("not found")
  );
}

// ---------- search_employers ----------

export async function searchEmployers(filters: EmployerSearchFilters): Promise<EmployerSearchResult> {
  const offset = (filters.page - 1) * filters.pageSize;
  const params: Record<string, unknown> = {
    p_query: filters.q?.trim() || null,
    p_fylkesnummer: filters.fylke || null,
    p_kommunenummer: filters.kommune || null,
    p_naeringskode_prefix: filters.nace || null,
    p_min_ansatte: filters.ansatteMin ?? null,
    p_max_ansatte: filters.ansatteMaks ?? null,
    p_min_omsetning: filters.omsMin ?? null,
    p_max_omsetning: filters.omsMaks ?? null,
    p_arbeidsgiver_type: filters.type || null,
    p_limit: filters.pageSize,
    p_offset: offset,
  };

  const { data, error } = await sb.rpc("search_employers", params);

  if (error) {
    if (isMissingRpcOrView(error)) {
      // eslint-disable-next-line no-console
      console.warn("[employer-insight] search_employers ikke tilgjengelig:", error);
      return { rows: [], totalCount: null, available: false, errorMessage: null };
    }
    const msg = (error as { message?: string }).message ?? "Ukjent feil";
    return { rows: [], totalCount: null, available: true, errorMessage: msg };
  }

  const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  // Hvis backend leverer total_count per rad, plukk den fra første rad.
  const firstTotal = arr.length > 0 ? (arr[0] as { total_count?: number }).total_count : undefined;
  const totalCount = typeof firstTotal === "number" ? firstTotal : null;

  return {
    rows: arr as EmployerSearchRow[],
    totalCount,
    available: true,
    errorMessage: null,
  };
}

export function searchEmployersQuery(filters: EmployerSearchFilters) {
  return queryOptions({
    queryKey: ["employer-search", filters],
    queryFn: () => searchEmployers(filters),
    staleTime: 30_000,
  });
}

// ---------- employer_search_v1 (detail) ----------

export type EmployerDetailLoadResult =
  | { kind: "ok"; data: EmployerDetail }
  | { kind: "not_found" }
  | { kind: "unavailable" }; // view mangler

export async function loadEmployerDetail(orgnr: string): Promise<EmployerDetailLoadResult> {
  const { data, error } = await sb
    .from("employer_search_v1")
    .select("*")
    .eq("organisasjonsnummer", orgnr)
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST116") return { kind: "not_found" };
    if (isMissingRpcOrView(error)) return { kind: "unavailable" };
    throw error;
  }

  if (!data) return { kind: "not_found" };
  return { kind: "ok", data: data as EmployerDetail };
}

export function employerDetailQuery(orgnr: string) {
  return queryOptions({
    queryKey: ["employer-detail", orgnr],
    queryFn: () => loadEmployerDetail(orgnr),
    staleTime: 60_000,
  });
}

// ---------- Paginering uten total ----------

export function hasNextPage(
  rows: ReadonlyArray<unknown>,
  pageSize: number,
  totalCount: number | null,
  page: number,
): boolean {
  if (totalCount !== null) return page * pageSize < totalCount;
  return rows.length === pageSize;
}
