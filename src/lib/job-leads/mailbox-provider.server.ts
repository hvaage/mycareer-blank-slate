/**
 * Provider-agnostic abstraction for reading job-ad emails from a user's mailbox.
 * All concrete implementations are server-only and loaded inside createServerFn
 * handlers to avoid leaking tokens or Node-only imports into the client bundle.
 */

import type { EmailInput } from "@/lib/job-leads/parse";

export type MailboxMessage = {
  providerMessageId: string;
  providerInternalDate: string; // epoch ms or ISO string; normalised by caller
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  sizeEstimate: number;
};

export type MailboxProviderConfig = {
  accessToken: string;
  refreshToken?: string | null;
  emailAddress: string;
  senderPattern?: string | null;
  filterQuery?: string | null;
  lastSyncedInternalDate?: string | null;
};

export type SyncResult = {
  messages: MailboxMessage[];
  nextInternalDate?: string | null;
  tokenRefreshed?: boolean;
  newAccessToken?: string | null;
  newTokenExpiresAt?: string | null;
};

export interface MailboxProvider {
  name: "google" | "microsoft";
  sync(config: MailboxProviderConfig): Promise<SyncResult>;
}

export function sanitizeEmailAddress(input: string): string {
  const match = input.match(/<([^>]+)>/);
  return (match ? match[1] : input).trim().toLowerCase();
}

export function normalizeInternalDate(value: string | number): string {
  const ms = typeof value === "string" ? Number(value) : value;
  if (!Number.isNaN(ms) && ms > 0) {
    return new Date(ms < 1e12 ? ms * 1000 : ms).toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function cleanEmailBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/=\n/g, "") // soft line breaks in quoted-printable
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
