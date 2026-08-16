// @ts-nocheck
/**
 * Kobling mellom arbeidsgiveranalyse-dokumenter og selskaper.
 *
 * `public.documents` har ingen `company_id`. Koblingen er navnebasert (fritekst
 * `company_name`), og derfor eksplisitt usikker. Vi lenker kun dokumenter der
 * navnet treffer nøyaktig ett selskap OG det selskapet har organisasjonsnummer.
 * Alt annet blir stående i dokumentlisten med merknad — ingenting forsvinner.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

export type EmployerAnalysisLinkStatus =
  | "linked" // ett navnetreff med organisasjonsnummer
  | "ambiguous" // flere selskapsrader med samme navn
  | "no_orgnr" // ett treff, men uten organisasjonsnummer i registeret
  | "unmatched"; // ingen selskapsrad med dette navnet

export type EmployerAnalysisLink = {
  documentId: string;
  companyName: string;
  status: EmployerAnalysisLinkStatus;
  companyId: string | null;
  organisasjonsnummer: string | null;
  matchCount: number;
};

export const LINK_STATUS_NOTE: Record<EmployerAnalysisLinkStatus, string> = {
  linked: "Koblet til selskap i registeret",
  ambiguous: "Usikker kobling: flere selskaper har dette navnet",
  no_orgnr: "Usikker kobling: selskapet mangler organisasjonsnummer",
  unmatched: "Usikker kobling: fant ingen selskapsrad med dette navnet",
};

/** Kjenner igjen en arbeidsgiveranalyse på tittel eller kategori. */
export function isEmployerAnalysisDoc(doc: {
  title?: string | null;
  documentation_category?: string | null;
}) {
  const hay = `${doc?.title ?? ""} ${doc?.documentation_category ?? ""}`.toLowerCase();
  return hay.includes("arbeidsgiveranalyse");
}

export function employerAnalysisDocCompanyName(doc: {
  company_name?: string | null;
  title?: string | null;
  applications?: { company_name?: string | null } | null;
}) {
  const direct = doc?.company_name ?? doc?.applications?.company_name ?? null;
  if (direct && String(direct).trim()) return String(direct).trim();
  const t = String(doc?.title ?? "");
  const m = t.split(/[—–-]/).slice(1).join("-").trim();
  return m || "";
}

function orFilterForNames(names: string[]) {
  return names
    .filter((n) => n && !n.includes('"'))
    .map((n) => `name.ilike."${n}"`)
    .join(",");
}

/** Slår opp navnetreff i `companies` for alle analysedokumenter. */
export const employerAnalysisDocLinksQuery = () =>
  queryOptions({
    queryKey: ["documentation", "employer-analysis-links"],
    queryFn: async (): Promise<Record<string, EmployerAnalysisLink>> => {
      const { data: docs, error } = await db
        .from("documents")
        .select("id, title, company_name, documentation_category, deleted_at")
        .is("deleted_at", null);
      if (error) throw error;

      const analysisDocs = (docs ?? []).filter(isEmployerAnalysisDoc);
      if (analysisDocs.length === 0) return {};

      const names = Array.from(
        new Set(
          analysisDocs
            .map((d: any) => employerAnalysisDocCompanyName(d))
            .filter((n: string) => n.length > 0),
        ),
      );

      let companies: any[] = [];
      const filter = orFilterForNames(names);
      if (filter) {
        const { data: comp, error: cErr } = await db
          .from("companies")
          .select("id, name, organisasjonsnummer")
          .or(filter);
        if (cErr) throw cErr;
        companies = comp ?? [];
      }

      const byName = new Map<string, any[]>();
      for (const c of companies) {
        const key = String(c.name ?? "").trim().toLowerCase();
        byName.set(key, [...(byName.get(key) ?? []), c]);
      }

      const out: Record<string, EmployerAnalysisLink> = {};
      for (const d of analysisDocs) {
        const companyName = employerAnalysisDocCompanyName(d);
        const matches = byName.get(companyName.toLowerCase()) ?? [];
        let status: EmployerAnalysisLinkStatus = "unmatched";
        let companyId: string | null = null;
        let orgnr: string | null = null;

        if (matches.length > 1) {
          status = "ambiguous";
        } else if (matches.length === 1) {
          const c = matches[0];
          orgnr = c.organisasjonsnummer ?? null;
          if (orgnr) {
            status = "linked";
            companyId = c.id;
          } else {
            status = "no_orgnr";
          }
        }

        out[d.id] = {
          documentId: d.id,
          companyName,
          status,
          companyId,
          organisasjonsnummer: orgnr,
          matchCount: matches.length,
        };
      }
      return out;
    },
  });

/** Analysedokumenter som er trygt koblet til ett bestemt selskap. */
export const employerAnalysisDocsForCompanyQuery = (
  companyId: string,
  companyName: string | null | undefined,
) =>
  queryOptions({
    queryKey: ["documentation", "employer-analysis-docs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const name = String(companyName ?? "").trim();
      if (!name) return [] as any[];
      const { data, error } = await db
        .from("documents")
        .select("id, title, document_type, company_name, updated_at, created_at, deleted_at")
        .is("deleted_at", null)
        .ilike("company_name", name)
        .order("updated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).filter(isEmployerAnalysisDoc);
    },
  });
