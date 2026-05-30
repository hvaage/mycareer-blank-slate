import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

export const documentationQueryKeys = {
  overviewCounts: ["documentation", "overview", "counts"] as const,
  professionalCases: ["documentation", "professional_cases"] as const,
  professionalResults: ["documentation", "professional_results"] as const,
  professionalCaseDocuments: ["documentation", "case_documents"] as const,
  documentsLibrary: ["documentation", "documents", "library"] as const,
  documentationPackages: ["documentation", "documentation_packages"] as const,
};

export type ProfessionalCaseInsert = {
  user_id: string;
  title: string;
  summary?: string | null;
  situation?: string | null;
  responsibility?: string | null;
  actions_taken?: string | null;
  results?: string | null;
};

export type ProfessionalResultInsert = {
  user_id: string;
  title: string;
  description?: string | null;
  metric_name?: string | null;
  metric_value?: string | null;
  time_period?: string | null;
};

export async function insertProfessionalCase(row: ProfessionalCaseInsert) {
  const { data, error } = await db
    .from("professional_cases")
    .insert(row as any)
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function insertProfessionalResult(row: ProfessionalResultInsert) {
  const { data, error } = await db
    .from("professional_results")
    .insert(row as any)
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export type CaseDocumentInsert = {
  user_id: string;
  case_id: string;
  document_id: string;
};

export async function insertCaseDocument(row: CaseDocumentInsert) {
  const { data, error } = await db
    .from("case_documents")
    .insert(row as any)
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function deleteCaseDocument(caseDocumentId: string) {
  const { error } = await db.from("case_documents").delete().eq("id", caseDocumentId);
  if (error) throw error;
}

export type DocumentationOverviewCounts = {
  documents: number;
  professionalCases: number;
  professionalResults: number;
  documentationPackages: number;
};

export const documentationOverviewCountsQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.overviewCounts,
    queryFn: async (): Promise<DocumentationOverviewCounts> => {
      const [docsRes, casesRes, resultsRes, packagesRes] = await Promise.all([
        db.from("documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
        db.from("professional_cases").select("id", { count: "exact", head: true }),
        db.from("professional_results").select("id", { count: "exact", head: true }),
        db.from("documentation_packages").select("id", { count: "exact", head: true }),
      ]);

      if (docsRes.error) throw docsRes.error;
      if (casesRes.error) throw casesRes.error;
      if (resultsRes.error) throw resultsRes.error;
      if (packagesRes.error) throw packagesRes.error;

      return {
        documents: docsRes.count ?? 0,
        professionalCases: casesRes.count ?? 0,
        professionalResults: resultsRes.count ?? 0,
        documentationPackages: packagesRes.count ?? 0,
      };
    },
  });

export const documentationLibraryDocumentsQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.documentsLibrary,
    queryFn: async () => {
      const { data, error } = await db
        .from("documents")
        .select(
          "id, title, updated_at, created_at, document_type, application_id, documentation_category, documentation_status, visibility, deleted_at, applications(company_name, role_title)",
        )
        .is("deleted_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Record<string, unknown>[];
    },
  });

export const professionalCasesListQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.professionalCases,
    queryFn: async () => {
      const { data, error } = await db
        .from("professional_cases")
        .select("*")
        .order("updated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const professionalResultsListQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.professionalResults,
    queryFn: async () => {
      const { data, error } = await db
        .from("professional_results")
        .select("*")
        .order("updated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const professionalCaseDocumentsQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.professionalCaseDocuments,
    queryFn: async () => {
      const { data, error } = await db
        .from("case_documents")
        .select("id, case_id, document_id, documents(id, title, document_type, updated_at)")
        .order("created_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const documentationPackagesListQuery = () =>
  queryOptions({
    queryKey: documentationQueryKeys.documentationPackages,
    queryFn: async () => {
      const { data, error } = await db
        .from("documentation_packages")
        .select(
          "id, title, description, package_type, status, visibility, target_role, target_company, updated_at, created_at",
        )
        .order("updated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
