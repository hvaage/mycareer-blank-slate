/**
 * Server-only provisioning of a user's private inbound job-email address.
 *
 * Invariants:
 *  - the alias is generated from cryptographic randomness on the server and is
 *    NEVER derived from the user id, the e-mail address or any other guessable
 *    value,
 *  - the alias is bound to exactly one user through a unique database index,
 *  - at most one forwarding source per user (enforced by a partial unique
 *    index), so repeated calls return the existing alias,
 *  - the caller must already be an authenticated, verified user id.
 */

import { randomBytes } from "crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // base32, matches the DB CHECK
export const ALIAS_TOKEN_LENGTH = 32;

/** Unguessable base32 token (160 bits of entropy at the default length). */
export function generateAliasToken(length = ALIAS_TOKEN_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

type AliasClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          maybeSingle: () => Promise<{
            data: { inbound_alias_token: string | null } | null;
            error: unknown;
          }>;
        };
      };
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: { inbound_alias_token: string | null } | null;
          error: { code?: string } | null;
        }>;
      };
    };
  };
};

export type EnsureAliasResult =
  | { ok: true; token: string; created: boolean }
  | { ok: false; reason: string };

/**
 * Returns the user's forwarding alias, creating it when missing. Concurrency
 * and token collisions are resolved by the database's unique indexes.
 */
export async function ensureForwardingAlias(
  admin: AliasClient,
  userId: string,
  attempts = 5,
): Promise<EnsureAliasResult> {
  const existing = await admin
    .from("email_job_sources")
    .select("inbound_alias_token")
    .eq("user_id", userId)
    .eq("intake_mode", "forwarding")
    .maybeSingle();

  const current = existing.data?.inbound_alias_token;
  if (typeof current === "string" && current) return { ok: true, token: current, created: false };

  for (let i = 0; i < attempts; i += 1) {
    const token = generateAliasToken();
    const inserted = await admin
      .from("email_job_sources")
      .insert({
        user_id: userId,
        intake_mode: "forwarding",
        source_system: "other",
        inbound_alias_token: token,
        is_active: true,
        label: "Videresendte jobb-e-poster",
      })
      .select("inbound_alias_token")
      .single();

    if (!inserted.error && inserted.data?.inbound_alias_token) {
      return { ok: true, token: inserted.data.inbound_alias_token, created: true };
    }
    // 23505: either a token collision (retry) or a concurrent provisioning for
    // the same user (re-read below).
    if (inserted.error?.code !== "23505") return { ok: false, reason: "provisioning_failed" };

    const raced = await admin
      .from("email_job_sources")
      .select("inbound_alias_token")
      .eq("user_id", userId)
      .eq("intake_mode", "forwarding")
      .maybeSingle();
    const token2 = raced.data?.inbound_alias_token;
    if (typeof token2 === "string" && token2) return { ok: true, token: token2, created: false };
  }

  return { ok: false, reason: "provisioning_failed" };
}
