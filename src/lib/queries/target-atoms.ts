// @ts-nocheck
import { queryOptions, type QueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
/** Company row for atom refresh: see `COMPANY_ATOM_REFRESH_SELECT` in `company-atom-refresh-select.ts`. */
import { refreshCompanyAtoms, refreshOpportunityAtoms, type RefreshCounts } from "@/lib/target-atom-refresh";

export type OpportunityRequirementAtomRow = Tables<"opportunity_requirement_atoms">;
export type CompanyProfileAtomRow = Tables<"company_profile_atoms">;
export type CompanySignalAtomRow = Tables<"company_signal_atoms">;

export type OpportunityAtomQueryKey = {
  listingId?: string | null;
  canonicalOpportunityId?: string | null;
};

function opportunityOrFilter(k: OpportunityAtomQueryKey): string | null {
  const parts: string[] = [];
  if (k.listingId) parts.push(`listing_id.eq.${k.listingId}`);
  if (k.canonicalOpportunityId) parts.push(`opportunity_id.eq.${k.canonicalOpportunityId}`);
  return parts.length ? parts.join(",") : null;
}

export const opportunityRequirementAtomsQuery = (key: OpportunityAtomQueryKey) => {
  const filt = opportunityOrFilter(key);
  return queryOptions({
    queryKey: ["opportunity-requirement-atoms", key.listingId, key.canonicalOpportunityId],
    enabled: !!filt,
    staleTime: 30_000,
    queryFn: async (): Promise<OpportunityRequirementAtomRow[]> => {
      const { data, error } = await supabase
        .from("opportunity_requirement_atoms")
        .select("*")
        .or(filt!)
        .eq("is_active", true)
        .order("category", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OpportunityRequirementAtomRow[];
    },
  });
};

export const companyProfileAtomsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["company-profile-atoms", companyId],
    enabled: !!companyId,
    staleTime: 30_000,
    queryFn: async (): Promise<CompanyProfileAtomRow[]> => {
      const { data, error } = await supabase
        .from("company_profile_atoms")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("category", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CompanyProfileAtomRow[];
    },
  });

export const companySignalAtomsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["company-signal-atoms", companyId],
    staleTime: 30_000,
    enabled: !!companyId,
    queryFn: async (): Promise<CompanySignalAtomRow[]> => {
      const { data, error } = await supabase
        .from("company_signal_atoms")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("signal_type", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CompanySignalAtomRow[];
    },
  });

export function invalidateTargetAtomQueries(queryClient: QueryClient, keys: { companyId?: string } & OpportunityAtomQueryKey) {
  void queryClient.invalidateQueries({
    queryKey: ["opportunity-requirement-atoms", keys.listingId, keys.canonicalOpportunityId],
  });
  if (keys.companyId) {
    void queryClient.invalidateQueries({ queryKey: ["company-profile-atoms", keys.companyId] });
    void queryClient.invalidateQueries({ queryKey: ["company-signal-atoms", keys.companyId] });
  }
}

export function refreshOpportunityAtomsMutation(
  queryClient: QueryClient,
  key: OpportunityAtomQueryKey,
): Pick<UseMutationOptions<RefreshCounts, Error, void>, "mutationFn" | "onSuccess"> {
  return {
    mutationFn: () =>
      refreshOpportunityAtoms({
        listingId: key.listingId ?? null,
        canonicalOpportunityId: key.canonicalOpportunityId ?? null,
      }),
    onSuccess: () => invalidateTargetAtomQueries(queryClient, key),
  };
}

export function refreshCompanyAtomsMutation(
  queryClient: QueryClient,
  companyId: string,
): Pick<UseMutationOptions<RefreshCounts, Error, void>, "mutationFn" | "onSuccess"> {
  return {
    mutationFn: () => refreshCompanyAtoms(companyId),
    onSuccess: () => invalidateTargetAtomQueries(queryClient, { companyId }),
  };
}
