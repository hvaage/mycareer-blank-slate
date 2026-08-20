// Serveronly: kanonisk kontrakt for LinkedIn-nettverksavstemming v2
// (Leveranse B, produktkontrakt for nettverk/muligheter).
//
// Denne motoren er, som v1, deterministisk: ingen KI, ingen nettverkskall,
// ingen skriving til produktdata. Den erstatter ikke v1-kontrakten for de
// øvrige domenene, men innfører et eget batch-basert opplegg spesifikt for
// nettverkskontakter, med kategorier og handlinger hentet fra databasens enums.

import { normKey, tokenSimilarity } from "../contract.server";

export const RECONCILIATION_VERSION = "linkedin_reconciliation_v2";

export const NETWORK_BATCH_ITEM_CATEGORIES = [
  "exact_identity_match",
  "possible_duplicate",
  "without_stable_identity",
  "observed_profile_change",
  "new_contact",
  "excluded",
] as const;
export type NetworkBatchItemCategory = (typeof NETWORK_BATCH_ITEM_CATEGORIES)[number];

export const NETWORK_BATCH_ITEM_ACTIONS = [
  "create_contact",
  "merge_into_contact",
  "review_manually",
  "skip",
] as const;
export type NetworkBatchItemAction = (typeof NETWORK_BATCH_ITEM_ACTIONS)[number];

export const NETWORK_BATCH_ITEM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "auto_applied",
] as const;
export type NetworkBatchItemStatus = (typeof NETWORK_BATCH_ITEM_STATUSES)[number];

export const NETWORK_BATCH_STATUSES = ["preparing", "ready", "consumed", "superseded"] as const;
export type NetworkBatchStatus = (typeof NETWORK_BATCH_STATUSES)[number];

export type NetworkBatchItem = {
  stagingRecordId?: string;
  sourceIdentityHash: string;
  category: NetworkBatchItemCategory;
  proposedAction: NetworkBatchItemAction;
  targetContactId?: string;
  reasonCodes: string[];
  sourceHash: string;
  observedAt?: string | null;
};

export type NetworkBatchCounts = {
  exactIdentityMatchCount: number;
  possibleDuplicateCount: number;
  withoutStableIdentityCount: number;
  observedProfileChangeCount: number;
  excludedCount: number;
};

export type NetworkBatch = {
  id: string;
  userId: string;
  importId: string;
  inputSignature: string;
  totalCount: number;
  counts: NetworkBatchCounts;
  status: NetworkBatchStatus;
  createdAt: string;
};

/** Minimalt kontaktgrunnlag for deterministisk matching. */
export type MatchableContact = {
  id: string;
  displayName: string | null;
  linkedinProfileUrl: string | null;
};

/**
 * Nøyaktig identitetsmatch: normalisert profil-URL er lik, eller (hvis ingen
 * URL finnes) normalisert e-post er lik. Returnerer den første treffende
 * kontakten, eller null hvis ingen stabil identitet matcher.
 */
export function exactIdentityMatch(
  source: { profileUrl?: string | null; email?: string | null },
  contacts: MatchableContact[],
): MatchableContact | null {
  const urlKey = normKey(source.profileUrl);
  if (urlKey) {
    const match = contacts.find((c) => normKey(c.linkedinProfileUrl) === urlKey);
    if (match) return match;
  }
  return null;
}

/**
 * Kandidater for mulig duplikat basert på token-likhet i navn (> 0.5),
 * sortert med høyest likhet først.
 */
export function possibleDuplicateByName(
  name: string,
  contacts: MatchableContact[],
): MatchableContact[] {
  const key = normKey(name);
  if (!key) return [];
  return contacts
    .map((c) => ({ contact: c, score: tokenSimilarity(key, normKey(c.displayName)) }))
    .filter((r) => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.contact);
}
