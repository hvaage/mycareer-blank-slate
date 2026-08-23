// @ts-nocheck
// ============================================================
// Fase 5H — leselag for selskapsidentitetsavstemming.
// Kun brukerens egne rader (RLS). Registerspeilet leses aldri
// direkte fra klienten; kandidatene er frosset i forslaget.
// ============================================================
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ReconciliationCandidate = {
  orgnr: string;
  navn: string;
  organisasjonsform?: string | null;
  kommune?: string | null;
  antall_ansatte?: number | null;
  score?: number | null;
};

export type ReconciliationRow = {
  id: string;
  source_system: string;
  source_record_id: string;
  observed_name: string;
  normalized_name: string;
  company_id: string | null;
  orgnr: string | null;
  match_method: string | null;
  confidence: number | null;
  state: string;
  candidates: ReconciliationCandidate[];
  confirmed_at: string | null;
  updated_at: string;
};

const PAGE_SIZE = 500;

export const SOURCE_LABEL: Record<string, string> = {
  network_contact_company_relation: "Kontakt (LinkedIn)",
  user_opportunity: "Mulighet",
};

export const STATE_LABEL: Record<string, string> = {
  suggested_exact: "Entydig kandidat",
  suggested_possible: "Mulig kandidat",
  not_found: "Ikke funnet i registeret",
  foreign_unknown: "Utenlandsk eller ukjent",
  confirmed: "Koblet",
  rejected: "Avvist",
  not_applicable: "Ikke aktuelt",
};

export const MATCH_METHOD_LABEL: Record<string, string> = {
  source_orgnr: "Organisasjonsnummer fra kilden",
  name_exact: "Entydig navnetreff, bekreftet",
  name_possible: "Valgt blant kandidater",
  manual_search: "Valgt i registersøk",
};

async function loadReconciliation(userId: string): Promise<ReconciliationRow[]> {
  const rows: ReconciliationRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("network_company_reconciliation")
      .select(
        "id, source_system, source_record_id, observed_name, normalized_name, company_id, orgnr, match_method, confidence, state, candidates, confirmed_at, updated_at",
      )
      .eq("user_id", userId)
      .is("superseded_at", null)
      .order("observed_name")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ReconciliationRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function companyReconciliationQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["network", "company-reconciliation", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: () => loadReconciliation(userId!),
  });
}

export type ReconciliationBuckets = {
  exact: ReconciliationRow[];
  possible: ReconciliationRow[];
  notFound: ReconciliationRow[];
  foreign: ReconciliationRow[];
  confirmed: ReconciliationRow[];
  dismissed: ReconciliationRow[];
};

/** Samme observerte navn kan opptre i mange kilder; arbeidslisten grupperes på navn. */
export function bucketReconciliation(rows: ReconciliationRow[]): ReconciliationBuckets {
  const buckets: ReconciliationBuckets = {
    exact: [],
    possible: [],
    notFound: [],
    foreign: [],
    confirmed: [],
    dismissed: [],
  };
  for (const row of rows) {
    if (row.state === "suggested_exact") buckets.exact.push(row);
    else if (row.state === "suggested_possible") buckets.possible.push(row);
    else if (row.state === "not_found") buckets.notFound.push(row);
    else if (row.state === "foreign_unknown") buckets.foreign.push(row);
    else if (row.state === "confirmed") buckets.confirmed.push(row);
    else buckets.dismissed.push(row);
  }
  return buckets;
}

const CONFIRM_MESSAGE: Record<string, string> = {
  not_found: "Forslaget finnes ikke lenger.",
  invalid_orgnr: "Ugyldig organisasjonsnummer.",
  not_in_register: "Organisasjonsnummeret finnes ikke i registeret.",
  candidate_not_allowed: "Selskapet er ikke blant de gyldige kandidatene for denne kilden.",
  company_unavailable: "Kunne ikke opprette selskapet fra registeret.",
  write_failed: "Kunne ikke lagre koblingen.",
};

/** Saniterte, brukervendte meldinger for bekreftelsesstatus fra RPC-en. */
export function reconciliationMessage(status: string | null | undefined): string {
  if (!status) return CONFIRM_MESSAGE.write_failed;
  return CONFIRM_MESSAGE[status] ?? CONFIRM_MESSAGE.write_failed;
}
