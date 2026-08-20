// Kanoniske konstanter for LinkedIn-import (fase 2).
// Speiler docs/linkedin-import-contract-v1.md §2.5, §7 og §8.1.
// Klientsikker: kun konstanter og rene funksjoner, ingen I/O.

export const LINKEDIN_CONTRACT_VERSION = "linkedin_import_contract_v1";
export const LINKEDIN_IDENTITY_VERSION = "linkedin_identity_v1";
export const CONNECTIONS_PARSER_VERSION = "connections_csv_preamble_v1";

export const LINKEDIN_PURPOSES = [
  "profile",
  "career",
  "network",
  "jobs",
  "learning",
  "content",
] as const;
export type LinkedInPurpose = (typeof LINKEDIN_PURPOSES)[number];

export const LINKEDIN_STAGING_DOMAINS = [
  "profile",
  "career",
  "recommendation",
  "network",
  "job",
  "learning",
  "content",
] as const;
export type LinkedInStagingDomain = (typeof LINKEDIN_STAGING_DOMAINS)[number];

/** §8.1 — konservative grenser. Ingen andre verdier skal oppfinnes i kode. */
export const LINKEDIN_LIMITS = {
  maxCompressedBytes: 200 * 1024 * 1024,
  maxUncompressedTotalBytes: 1024 * 1024 * 1024,
  maxSingleFileBytes: 200 * 1024 * 1024,
  maxArchiveEntries: 2000,
  maxCsvRows: 250_000,
  maxFieldBytes: 64 * 1024,
  maxCompressionRatio: 100,
} as const;

export type LinkedInFileClass = "A" | "B" | "C";

export type LinkedInFileSpec = {
  /** Regex mot normalisert arkivsti. */
  pattern: RegExp;
  fileClass: LinkedInFileClass;
  /** Kun klasse A: hvor innholdet stages. */
  domain?: LinkedInStagingDomain;
  recordKind?: string;
  purpose?: LinkedInPurpose;
  locatorType?: "csv_row" | "html_section" | "archive_file";
  /** Klasse C: hvorfor filen aldri leses. */
  excludedReason?: string;
};

/**
 * §2.5-inventaret. Medlems-id-suffiks (`_997361`) varierer per eksport og
 * matches derfor med `\d+`.
 */
export const LINKEDIN_FILE_SPECS: LinkedInFileSpec[] = [
  // ---------- Klasse A: profil ----------
  { pattern: /^Profile\.csv$/i, fileClass: "A", domain: "profile", recordKind: "profile_row", purpose: "profile", locatorType: "csv_row" },
  { pattern: /^Profile Summary\.csv$/i, fileClass: "A", domain: "profile", recordKind: "profile_summary", purpose: "profile", locatorType: "csv_row" },
  { pattern: /^Causes You Care About\.csv$/i, fileClass: "A", domain: "profile", recordKind: "cause", purpose: "profile", locatorType: "csv_row" },

  // ---------- Klasse A: karriere ----------
  { pattern: /^Positions\.csv$/i, fileClass: "A", domain: "career", recordKind: "position", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Education\.csv$/i, fileClass: "A", domain: "career", recordKind: "education", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Certifications\.csv$/i, fileClass: "A", domain: "career", recordKind: "certification", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Languages\.csv$/i, fileClass: "A", domain: "career", recordKind: "language", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Skills\.csv$/i, fileClass: "A", domain: "career", recordKind: "skill", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Volunteering\.csv$/i, fileClass: "A", domain: "career", recordKind: "volunteer", purpose: "career", locatorType: "csv_row" },

  // ---------- Klasse A: anbefalinger ----------
  { pattern: /^Recommendations_Received\.csv$/i, fileClass: "A", domain: "recommendation", recordKind: "recommendation_received", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Recommendations_Given\.csv$/i, fileClass: "A", domain: "recommendation", recordKind: "recommendation_given", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Endorsement_Received_Info\.csv$/i, fileClass: "A", domain: "recommendation", recordKind: "endorsement_received", purpose: "career", locatorType: "csv_row" },
  { pattern: /^Endorsement_Given_Info\.csv$/i, fileClass: "A", domain: "recommendation", recordKind: "endorsement_given", purpose: "career", locatorType: "csv_row" },

  // ---------- Klasse A: nettverk ----------
  { pattern: /^Connections\.csv$/i, fileClass: "A", domain: "network", recordKind: "connection", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Invitations\.csv$/i, fileClass: "A", domain: "network", recordKind: "invitation", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Company Follows\.csv$/i, fileClass: "A", domain: "network", recordKind: "company_follow", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Events\.csv$/i, fileClass: "A", domain: "network", recordKind: "event", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Hashtag_Follows_\d+\.csv$/i, fileClass: "A", domain: "network", recordKind: "hashtag_follow", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Member_Follows_\d+\.csv$/i, fileClass: "A", domain: "network", recordKind: "member_follow", purpose: "network", locatorType: "csv_row" },
  { pattern: /^Saved_Items_\d+\.csv$/i, fileClass: "A", domain: "network", recordKind: "saved_item", purpose: "network", locatorType: "csv_row" },

  // ---------- Klasse C: jobb (utelukket per produktkontrakt v1.1) ----------
  { pattern: /^Jobs\/Job Seeker Preferences\.csv$/i, fileClass: "C", excludedReason: "excluded_by_product_contract_v1_1" },
  { pattern: /^SavedJobAlerts\.csv$/i, fileClass: "C", excludedReason: "excluded_by_product_contract_v1_1" },
  { pattern: /^Jobs\/Saved Jobs(_\d+)?\.csv$/i, fileClass: "C", excludedReason: "excluded_by_product_contract_v1_1" },
  { pattern: /^Jobs\/Online Job Postings\.csv$/i, fileClass: "C", excludedReason: "excluded_by_product_contract_v1_1" },
  { pattern: /^Jobs\/Job Applications\.csv$/i, fileClass: "C", excludedReason: "excluded_by_product_contract_v1_1" },

  // ---------- Klasse A: læring ----------
  { pattern: /^Learning\.csv$/i, fileClass: "A", domain: "learning", recordKind: "course", purpose: "learning", locatorType: "csv_row" },

  // ---------- Klasse A: innhold ----------
  { pattern: /^Rich_Media\.csv$/i, fileClass: "A", domain: "content", recordKind: "rich_media", purpose: "content", locatorType: "csv_row" },
  { pattern: /^Articles\/.+\.html?$/i, fileClass: "A", domain: "content", recordKind: "article", purpose: "content", locatorType: "html_section" },

  // ---------- Klasse B: utsatt ----------
  { pattern: /^Shares_\d+\.csv$/i, fileClass: "B" },
  { pattern: /^Reactions_\d+\.csv$/i, fileClass: "B" },
  { pattern: /^Comments_\d+\.csv$/i, fileClass: "B" },
  { pattern: /^Votes_\d+\.csv$/i, fileClass: "B" },
  { pattern: /^InstantReposts_\d+\.csv$/i, fileClass: "B" },
  { pattern: /^learning_role_play_messages\.csv$/i, fileClass: "B" },
  { pattern: /^learning_coach_messages\.csv$/i, fileClass: "B" },
  { pattern: /^guide_messages\.csv$/i, fileClass: "B" },
  { pattern: /^VerifiedExternalCapability\.csv$/i, fileClass: "B" },

  // ---------- Klasse C: leses aldri ----------
  { pattern: /^messages\.csv$/i, fileClass: "C", excludedReason: "private_messages" },
  { pattern: /^Email Addresses\.csv$/i, fileClass: "C", excludedReason: "contact_identifiers" },
  { pattern: /^PhoneNumbers\.csv$/i, fileClass: "C", excludedReason: "contact_identifiers" },
  { pattern: /^Whatsapp Phone Numbers\.csv$/i, fileClass: "C", excludedReason: "contact_identifiers" },
  { pattern: /^Logins\.csv$/i, fileClass: "C", excludedReason: "security_telemetry" },
  { pattern: /^Security Challenges\.csv$/i, fileClass: "C", excludedReason: "security_telemetry" },
  { pattern: /^Verifications\/Verifications\.csv$/i, fileClass: "C", excludedReason: "identity_verification" },
  { pattern: /^Receipts_v2\.csv$/i, fileClass: "C", excludedReason: "billing" },
  { pattern: /^Registration\.csv$/i, fileClass: "C", excludedReason: "security_telemetry" },
  { pattern: /^LAN Ads Engagement\.csv$/i, fileClass: "C", excludedReason: "advertising" },
  { pattern: /^Ads Clicked\.csv$/i, fileClass: "C", excludedReason: "advertising" },
  { pattern: /^Inferences_about_you\.csv$/i, fileClass: "C", excludedReason: "inferred_profiling" },
  { pattern: /^Ad_Targeting\.csv$/i, fileClass: "C", excludedReason: "advertising" },
];

export function specForPath(archivePath: string): LinkedInFileSpec | null {
  return LINKEDIN_FILE_SPECS.find((s) => s.pattern.test(archivePath)) ?? null;
}
