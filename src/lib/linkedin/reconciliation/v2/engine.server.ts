// Serveronly: deterministisk avstemmingsmotor for LinkedIn-nettverksimport v2
// (Leveranse B).
//
// Kontrakt:
//   - leser kun linkedin_staging_records/linkedin_network_staging og
//     eksisterende network_contacts (READ-ONLY på produktdata)
//   - skriver kun til linkedin_network_reconciliation_batches(_items)
//   - ingen KI, ingen eksterne kall, ingen tilfeldighet
//   - idempotent: samme kildegrunnlag gir samme input_signature og gjenbrukes

import { sha256Hex } from "../../preflight.server";
import { hashSnapshot, normKey, tokenSimilarity } from "../contract.server";
import {
  RECONCILIATION_VERSION,
  exactIdentityMatch,
  type MatchableContact,
  type NetworkBatchItem,
  type NetworkBatchItemCategory,
} from "./contract.server";

// Avstemmingstabellene for nettverk v2 finnes i den genererte typefila, men
// motoren bruker en løs klienttype (som v1) for å unngå tett kobling til
// spesifikke join-varianter mellom staging-tabeller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = import("@supabase/supabase-js").SupabaseClient<any, "public", any>;

export type NetworkReconcileResult = {
  ok: boolean;
  batchId?: string;
  status?: string;
  error?: string;
  counts?: {
    exact_identity_match_count: number;
    possible_duplicate_count: number;
    without_stable_identity_count: number;
    observed_profile_change_count: number;
    new_contact_count: number;
    excluded_count: number;
  };
};

type NetworkStagingRow = {
  id: string;
  staging_domain: string;
  source_classification: string;
  source_identity_hash: string;
};

type NetworkFieldsRow = {
  staging_record_id: string;
  full_name: string | null;
  company: string | null;
  position: string | null;
  connected_on: string | null;
  profile_url: string | null;
};

/** Kjør nettverksavstemming v2 for en gitt import. Idempotent. */
export async function runNetworkReconciliationV2(
  admin: Admin,
  input: { userId: string; importId: string },
): Promise<NetworkReconcileResult> {
  const { data: stagingRows, error: stagingError } = await admin
    .from("linkedin_staging_records")
    .select("id, staging_domain, source_classification, source_identity_hash")
    .eq("last_linkedin_import_id", input.importId)
    .eq("user_id", input.userId)
    .eq("staging_domain", "network")
    .neq("source_classification", "excluded_by_product_contract_v1_1");
  if (stagingError) return { ok: false, error: "database_error" };

  const staging = (stagingRows ?? []) as NetworkStagingRow[];
  const recordIds = staging.map((s) => s.id);

  const { data: contactRows, error: contactError } = await admin
    .from("network_contacts")
    .select("id, display_name, linkedin_profile_url")
    .eq("user_id", input.userId)
    .eq("is_active", true);
  if (contactError) return { ok: false, error: "database_error" };

  const contacts: MatchableContact[] = (contactRows ?? []).map((c) => ({
    id: c.id,
    displayName: c.display_name ?? null,
    linkedinProfileUrl: c.linkedin_profile_url ?? null,
  }));

  const inputSignature = await sha256Hex(
    JSON.stringify({
      v: RECONCILIATION_VERSION,
      user_id: input.userId,
      import_id: input.importId,
      record_ids: [...recordIds].sort(),
    }),
  );

  const { data: existingBatch } = await admin
    .from("linkedin_network_reconciliation_batches")
    .select(
      "id, status, total_count, exact_identity_match_count, possible_duplicate_count, without_stable_identity_count, observed_profile_change_count, new_contact_count, excluded_count",
    )
    .eq("user_id", input.userId)
    .eq("input_signature", inputSignature)
    .eq("reconciliation_version", RECONCILIATION_VERSION)
    .maybeSingle();

  if (existingBatch && (existingBatch.status === "ready" || existingBatch.status === "consumed")) {
    return {
      ok: true,
      batchId: existingBatch.id,
      status: existingBatch.status,
      counts: {
        exact_identity_match_count: existingBatch.exact_identity_match_count ?? 0,
        possible_duplicate_count: existingBatch.possible_duplicate_count ?? 0,
        without_stable_identity_count: existingBatch.without_stable_identity_count ?? 0,
        observed_profile_change_count: existingBatch.observed_profile_change_count ?? 0,
        new_contact_count: existingBatch.new_contact_count ?? 0,
        excluded_count: existingBatch.excluded_count ?? 0,
      },
    };
  }

  const { data: batch, error: batchError } = await admin
    .from("linkedin_network_reconciliation_batches")
    .insert({
      user_id: input.userId,
      linkedin_import_id: input.importId,
      reconciliation_version: RECONCILIATION_VERSION,
      input_signature: inputSignature,
      status: "preparing",
      total_count: staging.length,
    })
    .select("id")
    .single();
  if (batchError || !batch) return { ok: false, error: "database_error" };

  let items: NetworkBatchItem[] = [];
  try {
    items = await buildBatchItems(admin, staging, recordIds, contacts);
  } catch {
    await admin
      .from("linkedin_network_reconciliation_batches")
      .update({ status: "superseded" })
      .eq("id", batch.id);
    return { ok: false, error: "engine_error" };
  }

  const byId = new Map(staging.map((s) => [s.id, s]));
  for (const item of items) {
    await admin.from("linkedin_network_reconciliation_batch_items").insert({
      user_id: input.userId,
      batch_id: batch.id,
      staging_record_id: item.stagingRecordId ?? null,
      source_identity_hash: item.sourceIdentityHash,
      category: item.category,
      proposed_action: item.proposedAction,
      target_contact_id: item.targetContactId ?? null,
      status: "pending",
      reason_codes: item.reasonCodes,
      source_hash: item.sourceHash,
      observed_at: item.observedAt ?? null,
    });
  }
  void byId; // brukt kun for evt. fremtidig referanse-oppslag

  const counts = countByCategory(items);

  await admin
    .from("linkedin_network_reconciliation_batches")
    .update({
      status: "ready",
      prepared_at: new Date().toISOString(),
      total_count: items.length,
      exact_identity_match_count: counts.exact_identity_match_count,
      possible_duplicate_count: counts.possible_duplicate_count,
      without_stable_identity_count: counts.without_stable_identity_count,
      observed_profile_change_count: counts.observed_profile_change_count,
      new_contact_count: counts.new_contact_count,
      excluded_count: counts.excluded_count,
    })
    .eq("id", batch.id);

  return { ok: true, batchId: batch.id, status: "ready", counts };
}

function countByCategory(items: NetworkBatchItem[]) {
  const init: Record<NetworkBatchItemCategory, number> = {
    exact_identity_match: 0,
    possible_duplicate: 0,
    without_stable_identity: 0,
    observed_profile_change: 0,
    new_contact: 0,
    excluded: 0,
  };
  for (const item of items) init[item.category] += 1;
  return {
    exact_identity_match_count: init.exact_identity_match,
    possible_duplicate_count: init.possible_duplicate,
    without_stable_identity_count: init.without_stable_identity,
    observed_profile_change_count: init.observed_profile_change,
    new_contact_count: init.new_contact,
    excluded_count: init.excluded,
  };
}

async function buildBatchItems(
  admin: Admin,
  staging: NetworkStagingRow[],
  recordIds: string[],
  contacts: MatchableContact[],
): Promise<NetworkBatchItem[]> {
  if (recordIds.length === 0) return [];

  const { data: fieldRows } = await admin
    .from("linkedin_network_staging")
    .select("staging_record_id, full_name, company, position, connected_on, profile_url")
    .in("staging_record_id", recordIds);

  const fieldsByRecord = new Map(
    (fieldRows ?? []).map((row: NetworkFieldsRow) => [row.staging_record_id, row]),
  );

  const items: NetworkBatchItem[] = [];
  for (const src of staging) {
    const fields = fieldsByRecord.get(src.id) ?? null;
    const name = fields?.full_name ?? null;
    const profileUrl = fields?.profile_url ?? null;
    const nameKey = normKey(name);
    const urlKey = normKey(profileUrl);

    const sourceHash = await hashSnapshot({
      name: nameKey || null,
      company: normKey(fields?.company ?? null) || null,
      position: normKey(fields?.position ?? null) || null,
      profile_url: urlKey || null,
      connected_on: fields?.connected_on ?? null,
    });

    const base = {
      stagingRecordId: src.id,
      sourceIdentityHash: src.source_identity_hash,
      sourceHash,
      observedAt: fields?.connected_on ?? null,
    };

    const exact = exactIdentityMatch({ profileUrl }, contacts);
    if (exact) {
      const nameChanged =
        Boolean(nameKey) &&
        Boolean(normKey(exact.displayName)) &&
        nameKey !== normKey(exact.displayName) &&
        tokenSimilarity(nameKey, normKey(exact.displayName)) < 1;
      if (nameChanged) {
        items.push({
          ...base,
          category: "observed_profile_change",
          proposedAction: "review_manually",
          targetContactId: exact.id,
          reasonCodes: ["profile_name_changed"],
        });
        continue;
      }
      items.push({
        ...base,
        category: "exact_identity_match",
        proposedAction: "merge_into_contact",
        targetContactId: exact.id,
        reasonCodes: ["url_match"],
      });
      continue;
    }

    if (!urlKey && !nameKey) {
      items.push({
        ...base,
        category: "without_stable_identity",
        proposedAction: "skip",
        reasonCodes: ["no_profile_url", "no_name"],
      });
      continue;
    }

    const duplicates = nameKey
      ? contacts
          .map((c) => ({ contact: c, score: tokenSimilarity(nameKey, normKey(c.displayName)) }))
          .filter((r) => r.score > 0.5)
          .sort((a, b) => b.score - a.score)
      : [];
    if (duplicates.length > 0) {
      items.push({
        ...base,
        category: "possible_duplicate",
        proposedAction: "review_manually",
        targetContactId: duplicates[0].contact.id,
        reasonCodes: ["name_similarity"],
      });
      continue;
    }

    items.push({
      ...base,
      category: "new_contact",
      proposedAction: "create_contact",
      reasonCodes: ["missing_in_product"],
    });
  }
  return items;
}
