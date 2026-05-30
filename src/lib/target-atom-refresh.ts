// @ts-nocheck
/**
 * Idempotent refresh plans + DB application for target-side atoms (Module 4.5).
 */

import { supabase } from "@/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  COMPANY_ATOM_REFRESH_SELECT,
  isCompanyAtomRefreshRow,
} from "@/lib/company-atom-refresh-select";
import {
  extractCompanyProfileAtoms,
  extractCompanySignalAtoms,
  extractOpportunityRequirementAtoms,
  type CompanyExtractInput,
  type ExtractedCompanyProfileAtom,
  type ExtractedCompanySignalAtom,
  type ExtractedRequirementAtom,
  type JobListingExtractInput,
} from "@/lib/target-atom-extraction";

function isoNow(): string {
  return new Date().toISOString();
}

export type OpportunityAtomRefreshPlan = {
  rows: Array<
    ExtractedRequirementAtom & {
      opportunity_id: string | null;
      listing_id: string | null;
      existingId?: string;
    }
  >;
  deactivateIds: string[];
  summary: string;
};

export type CompanyAtomRefreshPlan = {
  profileRows: Array<ExtractedCompanyProfileAtom & { company_id: string; existingId?: string }>;
  signalRows: Array<
    ExtractedCompanySignalAtom & {
      company_id: string;
      existingId?: string;
      observed_at: string;
      expires_at: string;
    }
  >;
  deactivateProfileIds: string[];
  deactivateSignalIds: string[];
  summary: string;
};

export function buildOpportunityAtomRefreshPlan(
  listing: JobListingExtractInput,
  canonicalOpportunityId: string | null,
  /** FK til `job_listings`; null når vi kun har kortfelter fra `user_opportunities`. */
  rowListingId: string | null,
  existing: Tables<"opportunity_requirement_atoms">[],
): OpportunityAtomRefreshPlan {
  const extracted = extractOpportunityRequirementAtoms(listing);
  const oppId = canonicalOpportunityId;

  const rows = extracted.map((e) => ({
    ...e,
    opportunity_id: oppId,
    listing_id: rowListingId,
  }));

  const newHashes = new Set(rows.map((r) => r.source_hash));
  const byHash = new Map(existing.map((r) => [r.source_hash ?? "", r]));
  for (const r of rows) {
    const hit = byHash.get(r.source_hash);
    if (hit?.is_active) r.existingId = hit.id;
  }

  const deactivateIds: string[] = [];
  for (const row of existing) {
    if (!row.is_active) continue;
    if (row.source !== "system") continue;
    if (row.source_hash && !newHashes.has(row.source_hash)) {
      deactivateIds.push(row.id);
    }
  }

  return {
    rows,
    deactivateIds,
    summary: `${rows.length} krav-atom(er) · ${deactivateIds.length} deaktiveringer`,
  };
}

export function buildCompanyAtomRefreshPlan(
  company: CompanyExtractInput,
  existingProfile: Tables<"company_profile_atoms">[],
  existingSignals: Tables<"company_signal_atoms">[],
): CompanyAtomRefreshPlan {
  const cid = company.id;
  const now = isoNow();
  const exp = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

  /** Persisted rows only: `extractCompany*` drops candidates below MIN_PROFILE / MIN_SIGNAL confidence. */
  const profExt = extractCompanyProfileAtoms(company).map((e) => ({
    ...e,
    company_id: cid,
  }));
  const sigExt = extractCompanySignalAtoms(company).map((e) => ({
    ...e,
    company_id: cid,
    observed_at: now,
    expires_at: exp,
  }));

  const ph = new Set(profExt.map((p) => p.source_hash));
  const sh = new Set(sigExt.map((s) => s.source_hash));

  const profByHash = new Map(existingProfile.map((r) => [r.source_hash ?? "", r]));
  for (const r of profExt) {
    const hit = profByHash.get(r.source_hash);
    if (hit?.is_active) r.existingId = hit.id;
  }

  const sigByHash = new Map(existingSignals.map((r) => [r.source_hash ?? "", r]));
  for (const r of sigExt) {
    const hit = sigByHash.get(r.source_hash);
    if (hit?.is_active) r.existingId = hit.id;
  }

  const deactivateProfileIds: string[] = [];
  for (const row of existingProfile) {
    if (!row.is_active) continue;
    if (row.source !== "system") continue;
    if (row.source_hash && !ph.has(row.source_hash)) deactivateProfileIds.push(row.id);
  }

  const deactivateSignalIds: string[] = [];
  for (const row of existingSignals) {
    if (!row.is_active) continue;
    if (row.source !== "system") continue;
    if (row.source_hash && !sh.has(row.source_hash)) deactivateSignalIds.push(row.id);
  }

  return {
    profileRows: profExt,
    signalRows: sigExt,
    deactivateProfileIds,
    deactivateSignalIds,
    summary: `${profExt.length} profil-atom(er) · ${sigExt.length} signal(er) · ${deactivateProfileIds.length + deactivateSignalIds.length} deaktiveringer`,
  };
}

export type RefreshCounts = {
  upserted: number;
  deactivated: number;
  summary: string;
};

/**
 * Refresh requirement atoms from `job_listings` and/or canonical opportunity card fields.
 */
export async function refreshOpportunityAtoms(params: {
  listingId: string | null;
  canonicalOpportunityId: string | null;
}): Promise<RefreshCounts> {
  const { listingId, canonicalOpportunityId } = params;

  let listingExtract: JobListingExtractInput;
  let oppId: string | null = canonicalOpportunityId;
  let listId: string | null = listingId;

  if (listingId) {
    const { data: listing, error: lErr } = await supabase
      .from("job_listings")
      .select("id, title, employer, location, description, salary, salary_min, salary_max, salary_currency, raw_data")
      .eq("id", listingId)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!listing) throw new Error("Stillingsrad ikke funnet");
    listingExtract = listing as JobListingExtractInput;
  } else if (canonicalOpportunityId) {
    const { data: uo, error: uErr } = await supabase
      .from("user_opportunities")
      .select(
        "canonical_opportunity_id, card_title, card_company, card_location, card_salary, card_salary_min, card_salary_max, card_salary_currency",
      )
      .eq("canonical_opportunity_id", canonicalOpportunityId)
      .maybeSingle();
    if (uErr) throw uErr;
    if (!uo) throw new Error("Fant ikke brukerens mulighet for denne kanoniske ID-en");
    listingExtract = {
      id: canonicalOpportunityId,
      title: uo.card_title,
      employer: uo.card_company,
      location: uo.card_location,
      description: null,
      salary: uo.card_salary,
      salary_min: uo.card_salary_min,
      salary_max: uo.card_salary_max,
      salary_currency: uo.card_salary_currency,
      raw_data: null,
    };
    listId = null;
    oppId = canonicalOpportunityId;
  } else {
    throw new Error("Oppgi listingId og/eller canonicalOpportunityId");
  }

  const orParts: string[] = [];
  if (listId) orParts.push(`listing_id.eq.${listId}`);
  if (oppId) orParts.push(`opportunity_id.eq.${oppId}`);
  const { data: existing, error: eErr } = await supabase
    .from("opportunity_requirement_atoms")
    .select("*")
    .or(orParts.join(","));
  if (eErr) throw eErr;

  const plan = buildOpportunityAtomRefreshPlan(
    listingExtract,
    oppId,
    listId,
    (existing ?? []) as Tables<"opportunity_requirement_atoms">[],
  );

  const now = isoNow();
  let upserted = 0;
  const touched = new Set<string>();

  for (const r of plan.rows) {
    const body: TablesUpdate<"opportunity_requirement_atoms"> = {
      opportunity_id: r.opportunity_id,
      listing_id: r.listing_id,
      category: r.category,
      dimension: r.dimension,
      label: r.label,
      normalized_value: r.normalized_value,
      description: r.description,
      importance_score: r.importance_score,
      confidence_score: r.confidence_score,
      source: r.source,
      source_field: r.source_field,
      source_hash: r.source_hash,
      inferred: r.inferred,
      is_active: true,
      refreshed_at: now,
      stale_at: null,
    };
    if (r.existingId) {
      touched.add(r.existingId);
      const { error } = await supabase.from("opportunity_requirement_atoms").update(body).eq("id", r.existingId);
      if (error) throw error;
    } else {
      const insert: TablesInsert<"opportunity_requirement_atoms"> = {
        ...body,
        opportunity_id: r.opportunity_id,
        listing_id: r.listing_id,
      };
      const { error } = await supabase.from("opportunity_requirement_atoms").insert(insert);
      if (error) throw error;
    }
    upserted++;
  }

  let deactivated = 0;
  for (const id of plan.deactivateIds) {
    if (touched.has(id)) continue;
    const { error } = await supabase
      .from("opportunity_requirement_atoms")
      .update({ is_active: false, stale_at: now, refreshed_at: now })
      .eq("id", id);
    if (error) throw error;
    deactivated++;
  }

  return { upserted, deactivated, summary: plan.summary };
}

export async function refreshCompanyAtoms(companyId: string): Promise<RefreshCounts> {
  const { data: company, error: cErr } = await supabase
    .from("companies")
    .select(COMPANY_ATOM_REFRESH_SELECT)
    .eq("id", companyId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!company || !isCompanyAtomRefreshRow(company)) throw new Error("Selskap ikke funnet");

  const [{ data: profExisting, error: pErr }, { data: sigExisting, error: sErr }] = await Promise.all([
    supabase.from("company_profile_atoms").select("*").eq("company_id", companyId),
    supabase.from("company_signal_atoms").select("*").eq("company_id", companyId),
  ]);
  if (pErr) throw pErr;
  if (sErr) throw sErr;

  const plan = buildCompanyAtomRefreshPlan(
    company as CompanyExtractInput,
    (profExisting ?? []) as Tables<"company_profile_atoms">[],
    (sigExisting ?? []) as Tables<"company_signal_atoms">[],
  );

  const now = isoNow();
  let upserted = 0;
  const touchedProf = new Set<string>();
  const touchedSig = new Set<string>();

  for (const r of plan.profileRows) {
    const body: TablesUpdate<"company_profile_atoms"> = {
      category: r.category,
      dimension: r.dimension,
      label: r.label,
      normalized_value: r.normalized_value,
      description: r.description,
      strength_score: r.strength_score,
      confidence_score: r.confidence_score,
      source: r.source,
      source_hash: r.source_hash,
      inferred: r.inferred,
      is_active: true,
      refreshed_at: now,
      stale_at: null,
    };
    if (r.existingId) {
      touchedProf.add(r.existingId);
      const { error } = await supabase.from("company_profile_atoms").update(body).eq("id", r.existingId);
      if (error) throw error;
    } else {
      const insert: TablesInsert<"company_profile_atoms"> = { ...body, company_id: r.company_id };
      const { error } = await supabase.from("company_profile_atoms").insert(insert);
      if (error) throw error;
    }
    upserted++;
  }

  for (const r of plan.signalRows) {
    const body: TablesUpdate<"company_signal_atoms"> = {
      signal_type: r.signal_type,
      label: r.label,
      description: r.description,
      signal_strength: r.signal_strength,
      confidence_score: r.confidence_score,
      source: r.source,
      source_hash: r.source_hash,
      is_active: true,
      observed_at: r.observed_at,
      expires_at: r.expires_at,
      refreshed_at: now,
      stale_at: null,
    };
    if (r.existingId) {
      touchedSig.add(r.existingId);
      const { error } = await supabase.from("company_signal_atoms").update(body).eq("id", r.existingId);
      if (error) throw error;
    } else {
      const insert: TablesInsert<"company_signal_atoms"> = { ...body, company_id: r.company_id };
      const { error } = await supabase.from("company_signal_atoms").insert(insert);
      if (error) throw error;
    }
    upserted++;
  }

  let deactivated = 0;
  for (const id of plan.deactivateProfileIds) {
    if (touchedProf.has(id)) continue;
    const { error } = await supabase
      .from("company_profile_atoms")
      .update({ is_active: false, stale_at: now, refreshed_at: now })
      .eq("id", id);
    if (error) throw error;
    deactivated++;
  }
  for (const id of plan.deactivateSignalIds) {
    if (touchedSig.has(id)) continue;
    const { error } = await supabase
      .from("company_signal_atoms")
      .update({ is_active: false, stale_at: now, refreshed_at: now })
      .eq("id", id);
    if (error) throw error;
    deactivated++;
  }

  return { upserted, deactivated, summary: plan.summary };
}