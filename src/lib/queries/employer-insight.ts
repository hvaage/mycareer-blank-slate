/**
 * Typed wrapper rundt Supabase-kallene for Arbeidsgiverinnsikt.
 *
 * Frontend skal aldri SELECT direkte mot `reg.*`. Vi går via:
 *   - RPC `public.search_employers`
 *   - view `public.employer_search_v1`
 *
 * Vanlig bruker skal aldri behøve å kjenne kommunenummer eller NACE-koder.
 * Tekstsøk på kommune og bransje er primært UI; kodefelt er "avansert".
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------- Felles types ----------

export type EmployerSearchFilters = {
  q?: string;
  // Tekstsøk — primært UI
  kommuneQuery?: string;
  bransjeQuery?: string;
  // Kodefelt — avansert
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
 * Felt fra `search_employers` RPC (= `employer_search_v1`). Alt optional —
 * UI tåler at backend ikke leverer feltet ennå.
 */
export type EmployerSearchRow = {
  organisasjonsnummer: string;
  navn: string;
  // Sted — Brreg er source of truth
  forretningsadresse_kommune?: string | null;
  forretningsadresse_kommunenummer?: string | null;
  forretningsadresse_fylke?: string | null;
  forretningsadresse_fylkesnummer?: string | null;
  // Bransje — Brreg næringskoder
  naeringskode1_kode?: string | null;
  naeringskode1_beskrivelse?: string | null;
  // Ansatte og økonomi
  antall_ansatte?: number | null;
  /** false = Brreg har ikke tallet (ukjent), ikke "null ansatte". */
  har_registrert_antall_ansatte?: boolean | null;
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
  /**
   * @deprecated Backend gir ikke lenger estimater. Alltid false.
   * Over taket brukes `totalIsCapped` og teksten "over N treff".
   */
  totalIsEstimate: boolean;
  /** true = flere treff enn tellegrensen (`totalCount` = grensen, ikke et faktisk antall). */
  totalIsCapped: boolean;
  /** Satt når søket ble avvist uten å telle, f.eks. "min_query_length". */
  emptyReason: string | null;
  available: boolean;
  errorMessage: string | null;
};



/**
 * Felt fra `employer_search_v1` view. Speilet 1:1 mot Brreg-feltnavn.
 */
export type EmployerDetail = {
  organisasjonsnummer: string;
  navn: string;
  // Brreg adresse
  forretningsadresse_kommune?: string | null;
  forretningsadresse_kommunenummer?: string | null;
  forretningsadresse_fylke?: string | null;
  forretningsadresse_fylkesnummer?: string | null;
  forretningsadresse_poststed?: string | null;
  forretningsadresse_postnummer?: string | null;
  // Brreg form og næring
  organisasjonsform_kode?: string | null;
  organisasjonsform_beskrivelse?: string | null;
  naeringskode1_kode?: string | null;
  naeringskode1_beskrivelse?: string | null;
  naeringskode2_kode?: string | null;
  naeringskode2_beskrivelse?: string | null;
  naeringskode3_kode?: string | null;
  naeringskode3_beskrivelse?: string | null;
  aktivitet?: string | null;
  institusjonell_sektorkode?: string | null;
  stiftelsesdato?: string | null;
  selskapsalder_aar?: number | null;
  registrert_i_foretaksregisteret?: boolean | null;
  registrert_i_mvaregisteret?: boolean | null;
  registrert_i_frivillighetsregisteret?: boolean | null;
  er_i_konsern?: boolean | null;
  overordnet_enhet?: string | null;
  konkurs?: boolean | null;
  under_avvikling?: boolean | null;
  slettet?: boolean | null;
  er_offentlig?: boolean | null;
  arbeidsgiver_type?: string | null;
  hjemmeside?: string | null;
  // Regnskap — siste tilgjengelige år
  regnskapsaar?: number | null;
  regnskapstype?: string | null;
  driftsinntekter?: number | null;
  driftsresultat?: number | null;
  aarsresultat?: number | null;
  sum_egenkapital?: number | null;
  sum_gjeld?: number | null;
  sum_eiendeler?: number | null;
  sum_omloepsmidler?: number | null;
  sum_anleggsmidler?: number | null;
  driftsmargin_prosent?: number | null;
  aarsresultat_margin_prosent?: number | null;
  egenkapitalandel_prosent?: number | null;
  gjeldsgrad?: number | null;
  omsetning_per_ansatt?: number | null;
  antall_ansatte?: number | null;
  /** false = Brreg har ikke tallet (ukjent), ikke "null ansatte". */
  har_registrert_antall_ansatte?: boolean | null;
  ansatte_bucket?: string | null;

  omsetning_bucket?: string | null;
  valuta?: string | null;
  // 6-dim AI
  ai_culture_score?: number | null;
  ai_leadership_score?: number | null;
  ai_work_environment_score?: number | null;
  ai_career_development_score?: number | null;
  ai_financial_stability_score?: number | null;
  ai_mission_score?: number | null;
  ai_overall_score?: number | null;
  ai_rating_notes?: string | null;
  ai_dimension_notes?: unknown;
  ai_rated_at?: string | null;
  // Aggregerte ansattvurderinger
  agg_culture_score?: number | null;
  agg_leadership_score?: number | null;
  agg_work_environment_score?: number | null;
  agg_career_development_score?: number | null;
  agg_financial_stability_score?: number | null;
  agg_mission_score?: number | null;
  agg_overall_score?: number | null;
  agg_rating_count?: number | null;
  // Aggregerte søkervurderinger (optional)
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
  regnskap_last_success_at?: string | null;
  available_pdf_years?: number[] | null;
  research_log?: unknown;
  risiko_flags?: string[] | null;
  datakvalitet_flags?: string[] | null;
};

// ---------- Internal helpers ----------

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
    (msg.includes("function") && msg.includes("not found"))
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
    p_kommune_query: filters.kommuneQuery?.trim() || null,
    p_bransje_query: filters.bransjeQuery?.trim() || null,
    p_min_ansatte: filters.ansatteMin ?? null,
    p_max_ansatte: filters.ansatteMaks ?? null,
    p_min_omsetning: filters.omsMin ?? null,
    p_max_omsetning: filters.omsMaks ?? null,
    p_arbeidsgiver_type: filters.type || null,
    p_limit: filters.pageSize,
    p_offset: offset,
  };



  // Treffantall kommer fra egen RPC: `search_employers` returnerer bare siden.
  // Uten den ville brukeren aldri se hvor mange treff søket ga.
  const countParams = { ...params };
  delete countParams.p_limit;
  delete countParams.p_offset;

  const [{ data, error }, countRes] = await Promise.all([
    sb.rpc("search_employers", params),
    sb.rpc("count_employers", countParams),
  ]);

  if (error) {
    if (isMissingRpcOrView(error)) {
      // eslint-disable-next-line no-console
      console.warn("[employer-insight] search_employers ikke tilgjengelig:", error);
      return { rows: [], totalCount: null, totalIsEstimate: false, totalIsCapped: false, emptyReason: null, available: false, errorMessage: null };
    }
    const msg = (error as { message?: string }).message ?? "Ukjent feil";
    return { rows: [], totalCount: null, totalIsEstimate: false, totalIsCapped: false, emptyReason: null, available: true, errorMessage: msg };
  }

  const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

  let totalCount: number | null = null;
  let totalIsCapped = false;
  let emptyReason: string | null = null;
  if (!countRes.error && countRes.data && typeof countRes.data === "object") {
    const c = countRes.data as { total_count?: number; capped?: boolean; reason?: string | null };
    if (typeof c.total_count === "number") {
      totalCount = c.total_count;
      totalIsCapped = c.capped === true;
    }
    emptyReason = typeof c.reason === "string" ? c.reason : null;
  } else if (countRes.error) {
    // eslint-disable-next-line no-console
    console.warn("[employer-insight] count_employers feilet:", countRes.error);
  }

  return {
    rows: arr as EmployerSearchRow[],
    totalCount,
    totalIsEstimate: false,
    totalIsCapped,
    emptyReason,
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

// ---------- employer_ansatte_distribution ----------

/**
 * Tre-delt ansattefordeling for gjeldende søk og filtre. Ansatteintervallet
 * holdes bevisst utenfor: dette er grunnlaget for å si hvor mange treff som
 * faller bort fordi ansattetallet er ukjent.
 */
export type AnsatteFordelingResult = {
  fem_eller_flere: number;
  null_til_fire: number;
  ukjent: number;
  total: number;
  capped: boolean;
  available: boolean;
};

export async function loadAnsatteFordeling(
  filters: EmployerSearchFilters,
): Promise<AnsatteFordelingResult> {
  const { data, error } = await sb.rpc("employer_ansatte_distribution", {
    p_query: filters.q?.trim() || null,
    p_fylkesnummer: filters.fylke || null,
    p_kommunenummer: filters.kommune || null,
    p_naeringskode_prefix: filters.nace || null,
    p_kommune_query: filters.kommuneQuery?.trim() || null,
    p_bransje_query: filters.bransjeQuery?.trim() || null,
    p_min_omsetning: filters.omsMin ?? null,
    p_max_omsetning: filters.omsMaks ?? null,
    p_arbeidsgiver_type: filters.type || null,
  });

  const tom: AnsatteFordelingResult = {
    fem_eller_flere: 0,
    null_til_fire: 0,
    ukjent: 0,
    total: 0,
    capped: false,
    available: false,
  };

  if (error || !data || typeof data !== "object") {
    if (error && !isMissingRpcOrView(error)) {
      // eslint-disable-next-line no-console
      console.warn("[employer-insight] employer_ansatte_distribution feilet:", error);
    }
    return tom;
  }

  const d = data as Record<string, unknown>;
  const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  return {
    fem_eller_flere: num("fem_eller_flere"),
    null_til_fire: num("null_til_fire"),
    ukjent: num("ukjent"),
    total: num("total"),
    capped: d.capped === true,
    available: true,
  };
}

export function ansatteFordelingQuery(filters: EmployerSearchFilters) {
  const { page: _page, pageSize: _pageSize, ansatteMin: _min, ansatteMaks: _maks, ...rest } = filters;
  return queryOptions({
    queryKey: ["employer-ansatte-fordeling", rest],
    queryFn: () => loadAnsatteFordeling(filters),
    staleTime: 60_000,
  });
}



// ---------- get_employer_detail (detail) ----------

export type EmployerDetailLoadResult =
  | { kind: "ok"; data: EmployerDetail }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export async function loadEmployerDetail(orgnr: string): Promise<EmployerDetailLoadResult> {
  // Går via SECURITY DEFINER-RPC: frontend har ingen direkte lesetilgang til `reg.*`.
  const { data, error } = await sb.rpc("get_employer_detail", {
    p_organisasjonsnummer: orgnr,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST116") return { kind: "not_found" };
    if (isMissingRpcOrView(error)) return { kind: "unavailable" };
    throw error;
  }

  const row = Array.isArray(data) ? (data[0] as EmployerDetail | undefined) : (data as EmployerDetail | null);
  if (!row) return { kind: "not_found" };
  return { kind: "ok", data: row };
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
