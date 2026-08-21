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
  normalizeLinkedInProfileUrl,
  objectKindForRecordKind,
  type MatchableContact,
  type NetworkBatchItem,
  type NetworkBatchItemCategory,
  type NetworkObjectKind,
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
  sourceTotal?: number;
  processedTotal?: number;
  sourcePages?: number;
  counts?: {
    exact_identity_match_count: number;
    possible_duplicate_count: number;
    without_stable_identity_count: number;
    observed_profile_change_count: number;
    new_contact_count: number;
    excluded_count: number;
  };
  /** Tellinger per objektklasse og kategori. Aldri blandet i én teller. */
  objectKindCounts?: Record<string, Record<string, number>>;
};


/** PostgREST-sidestørrelse for kildeuttrekk. Under standardtaket på 1000. */
const PAGE_SIZE = 500;
/** Maksimalt antall identifikatorer per `in()`-oppslag (URL-lengde). */
const LOOKUP_CHUNK = 200;

class EngineError extends Error {}

/**
 * Henter ALLE rader med deterministisk paginering og stabil sortering.
 * Kaster ved databasefeil — en avkortet side blir aldri stille akseptert.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; pages: number }> {
  const rows: T[] = [];
  let pages = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new EngineError("database_error");
    pages += 1;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, pages };
}

function chunk<T>(items: T[], size = LOOKUP_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type NetworkStagingRow = {
  id: string;
  staging_domain: string;
  record_kind: string;
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
  // Fullstendig, deterministisk kildeuttrekk: alle sider, stabil sortering.
  // Ekskluderte rader hentes med, slik at kategorisummen alltid dekker hele
  // kildegrunnlaget i stedet for et filtrert utsnitt.
  let staging: NetworkStagingRow[];
  let sourcePages: number;
  try {
    const page = await fetchAllPages<NetworkStagingRow>((from, to) =>
      admin
        .from("linkedin_staging_records")
        .select("id, staging_domain, record_kind, source_classification, source_identity_hash")
        .eq("last_linkedin_import_id", input.importId)
        .eq("user_id", input.userId)
        .eq("staging_domain", "network")
        .order("id", { ascending: true })
        .range(from, to),
    );
    staging = page.rows;
    sourcePages = page.pages;
  } catch {
    return { ok: false, error: "database_error" };
  }

  const sourceTotal = staging.length;
  const recordIds = staging.map((s) => s.id);

  const { data: contactRows, error: contactError } = await admin
    .from("network_contacts")
    .select("id, display_name")
    .eq("user_id", input.userId)
    .eq("is_active", true);
  if (contactError) return { ok: false, error: "database_error" };

  // Kanonisk eier av LinkedIn-profil-URL er network_contact_identities.
  const { data: identityRows, error: identityError } = await admin
    .from("network_contact_identities")
    .select("network_contact_id, identity_key")
    .eq("user_id", input.userId)
    .eq("identity_kind", "linkedin_profile_url");
  if (identityError) return { ok: false, error: "database_error" };

  const keysByContact = new Map<string, string[]>();
  for (const row of identityRows ?? []) {
    const key = normalizeLinkedInProfileUrl(row.identity_key);
    if (!key) continue;
    const list = keysByContact.get(row.network_contact_id) ?? [];
    list.push(key);
    keysByContact.set(row.network_contact_id, list);
  }

  const contacts: MatchableContact[] = (contactRows ?? []).map((c) => ({
    id: c.id,
    displayName: c.display_name ?? null,
    identityKeys: keysByContact.get(c.id) ?? [],
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

  const abort = async (error: string): Promise<NetworkReconcileResult> => {
    await admin
      .from("linkedin_network_reconciliation_batches")
      .update({ status: "superseded" })
      .eq("id", batch.id);
    return { ok: false, error, sourceTotal, sourcePages };
  };

  let items: NetworkBatchItem[] = [];
  try {
    items = await buildBatchItems(admin, staging, recordIds, contacts);
  } catch {
    return abort("engine_error");
  }

  // Ufullstendig behandling skal aldri bli en tilsynelatende gyldig batch.
  if (items.length !== sourceTotal) return abort("engine_error");

  for (const part of chunk(items)) {
    const { error: itemError } = await admin
      .from("linkedin_network_reconciliation_batch_items")
      .insert(
        part.map((item) => ({
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
        })),
      );
    if (itemError) return abort("database_error");
  }

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

  return {
    ok: true,
    batchId: batch.id,
    status: "ready",
    counts,
    objectKindCounts: countByObjectKind(items),
    sourceTotal,
    processedTotal: items.length,
    sourcePages,
  };
}

/** Tellinger per objektklasse og kategori. */
function countByObjectKind(items: NetworkBatchItem[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const item of items) {
    const kind: NetworkObjectKind = item.objectKind;
    out[kind] ??= {};
    out[kind]![item.category] = (out[kind]![item.category] ?? 0) + 1;
  }
  return out;
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

  // Feltoppslag i chunks på maks 200 ID-er. Databasefeil avslutter kjøringen;
  // en rad blir aldri stille degradert til «uten stabil identitet».
  const fieldsByRecord = new Map<string, NetworkFieldsRow>();
  for (const part of chunk(recordIds)) {
    const { data, error } = await admin
      .from("linkedin_network_staging")
      .select("staging_record_id, full_name, company, position, connected_on, profile_url")
      .in("staging_record_id", part);
    if (error) throw new EngineError("field_lookup_failed");
    for (const row of (data ?? []) as NetworkFieldsRow[]) {
      fieldsByRecord.set(row.staging_record_id, row);
    }
  }

  const items: NetworkBatchItem[] = [];
  for (const src of staging) {
    const objectKind = objectKindForRecordKind(src.record_kind);

    if (src.source_classification === "excluded_by_product_contract_v1_1") {
      items.push({
        objectKind,
        stagingRecordId: src.id,
        sourceIdentityHash: src.source_identity_hash,
        sourceHash: src.source_identity_hash,
        observedAt: null,
        category: "excluded",
        proposedAction: "skip",
        reasonCodes: ["excluded_by_product_contract_v1_1", `object_kind:${objectKind}`],
      });
      continue;
    }

    const fields = fieldsByRecord.get(src.id) ?? null;
    // Manglende hydrering er en motorfeil, ikke «uten stabil identitet».
    if (!fields) throw new EngineError("missing_domain_fields");
    const name = fields?.full_name ?? null;
    const profileUrl = fields?.profile_url ?? null;
    const nameKey = normKey(name);
    const urlKey = normalizeLinkedInProfileUrl(profileUrl);

    const sourceHash = await hashSnapshot({
      name: nameKey || null,
      company: normKey(fields?.company ?? null) || null,
      position: normKey(fields?.position ?? null) || null,
      profile_url: urlKey || null,
      connected_on: fields?.connected_on ?? null,
    });

    const base = {
      objectKind,
      stagingRecordId: src.id,
      sourceIdentityHash: src.source_identity_hash,
      sourceHash,
      observedAt: fields?.connected_on ?? null,
    };

    // Ikke-personobjekter kan aldri bli kontakter. De holdes utenfor
    // kontaktkategoriene og telles per objektklasse.
    if (objectKind !== "person_contact") {
      items.push({
        ...base,
        category: "excluded",
        proposedAction: "skip",
        reasonCodes: ["not_a_person_contact", `object_kind:${objectKind}`],
      });
      continue;
    }

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
          reasonCodes: ["profile_name_changed", `object_kind:${objectKind}`],
        });
        continue;
      }
      items.push({
        ...base,
        category: "exact_identity_match",
        proposedAction: "merge_into_contact",
        targetContactId: exact.id,
        reasonCodes: ["url_match", `object_kind:${objectKind}`],
      });
      continue;
    }

    // Navn uten normalisert LinkedIn-URL gir aldri stabil personidentitet og
    // kan aldri auto-sammenslås.
    if (!urlKey) {
      items.push({
        ...base,
        category: "without_stable_identity",
        proposedAction: "review_manually",
        reasonCodes: [
          "possible_person_without_stable_identity",
          "no_profile_url",
          `object_kind:${objectKind}`,
        ],
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
        reasonCodes: ["name_similarity", `object_kind:${objectKind}`],
      });
      continue;
    }

    items.push({
      ...base,
      category: "new_contact",
      proposedAction: "create_contact",
      reasonCodes: ["missing_in_product", `object_kind:${objectKind}`],
    });

  }
  return items;
}
