// Serveronly: kanonisk kontrakt for LinkedIn-nettverksavstemming v2
// (Leveranse B, produktkontrakt for nettverk/muligheter).
//
// Denne motoren er, som v1, deterministisk: ingen KI, ingen nettverkskall,
// ingen skriving til produktdata. Den erstatter ikke v1-kontrakten for de
// øvrige domenene, men innfører et eget batch-basert opplegg spesifikt for
// nettverkskontakter, med kategorier og handlinger hentet fra databasens enums.

import { normKey, tokenSimilarity } from "../contract.server";

export const RECONCILIATION_VERSION = "linkedin_reconciliation_v2";

/**
 * Objektklasser i nettverksimporten. Kun `person_contact` kan bli en kontakt.
 * Selskapsfølging, arrangementer og emneknagger er aldri personer.
 */
export const NETWORK_OBJECT_KINDS = [
  "person_contact",
  "invitation",
  "company_observation",
  "network_event",
  "network_preference_signal",
  "other",
] as const;
export type NetworkObjectKind = (typeof NETWORK_OBJECT_KINDS)[number];

export function objectKindForRecordKind(recordKind: string): NetworkObjectKind {
  switch (recordKind) {
    case "connection":
    case "member_follow":
      return "person_contact";
    case "invitation":
      return "invitation";
    case "company_follow":
      return "company_observation";
    case "event":
      return "network_event";
    case "hashtag_follow":
      return "network_preference_signal";
    default:
      return "other";
  }
}


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

/**
 * Minimalt kontaktgrunnlag for deterministisk matching.
 * `identityKeys` kommer fra `network_contact_identities`, som er eneste
 * kanoniske eier av LinkedIn-profil-URL. Kontakttabellen dupliserer den ikke.
 */
export type MatchableContact = {
  id: string;
  displayName: string | null;
  identityKeys: string[];
};

/**
 * Deterministisk normalisering av en LinkedIn-profil-URL:
 * små bokstaver, uten protokoll, «www.», query, fragment og etterfølgende «/».
 * Ugyldige eller tomme verdier gir tom streng.
 */
export function normalizeLinkedInProfileUrl(value: string | null | undefined): string {
  const raw = (value ?? "").normalize("NFKC").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host: string;
  let path: string;
  try {
    const u = new URL(withScheme);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    path = u.pathname;
  } catch {
    return "";
  }
  if (!host.endsWith("linkedin.com")) return "";
  const cleanPath = decodeURIComponent(path)
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/^\/+/, "/");
  if (!cleanPath || cleanPath === "/") return "";
  return `${host}${cleanPath}`;
}

/**
 * Nøyaktig identitetsmatch mot kanoniske identiteter: normalisert profil-URL
 * er lik en registrert `linkedin_profile_url`-identitet. Navn brukes aldri her.
 */
export function exactIdentityMatch(
  source: { profileUrl?: string | null },
  contacts: MatchableContact[],
): MatchableContact | null {
  const urlKey = normalizeLinkedInProfileUrl(source.profileUrl);
  if (!urlKey) return null;
  return contacts.find((c) => c.identityKeys.includes(urlKey)) ?? null;
}


/**
 * Kandidater for mulig duplikat basert på token-likhet i navn (> 0.5),
 * sortert med høyest likhet først. Navn alene gir aldri eksakt identitet.
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

