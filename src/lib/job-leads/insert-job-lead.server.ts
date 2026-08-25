import { createHash } from "crypto";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";

type AdminClient = typeof supabaseAdmin;

/** Samme URL-hash som e-postinntaket bruker (sha256 av URL-en som den er). */
export function hashLeadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return createHash("sha256").update(url).digest("hex");
}

export type JobLeadDedupPayload = Record<string, unknown> & {
  user_id: string;
};

/**
 * Setter inn en job_leads-rad via SECURITY DEFINER-RPC-en med dedup.
 * Returnerer alltid rad-id når raden finnes etter kallet:
 * - wasInserted=true: ny rad ble opprettet.
 * - wasInserted=false: eksisterende duplikatrad (URL-hash- eller
 *   legacy-kontrakt håndteres deterministisk i databasen).
 */
export async function insertJobLeadDeduped(
  admin: AdminClient,
  payload: JobLeadDedupPayload,
): Promise<{ leadId: string | null; wasInserted: boolean }> {
  const { data, error } = await admin.rpc("insert_job_lead_dedup", {
    p_payload: payload,
  } as never);
  if (error) {
    throw new Error(`insert_job_lead_dedup: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  const leadId = (row as { lead_id?: string | null } | null)?.lead_id ?? null;
  const wasInserted =
    (row as { was_inserted?: boolean } | null)?.was_inserted === true;
  return { leadId, wasInserted };
}

/**
 * Registrerer leadet i dedupe-nøkkelregisteret. `source` skal være den
 * stabile backend-kilden (source_system), ikke en UI-kategori.
 */
export async function registerLeadForUser(
  admin: AdminClient,
  args: {
    userId: string;
    source: string;
    priority: number;
    jobUrl?: string | null;
    title?: string | null;
    company?: string | null;
    location?: string | null;
    refId: string;
  },
): Promise<void> {
  const { data: dedupeKey } = await admin.rpc("normalize_lead_key", {
    p_url: args.jobUrl ?? null,
    p_company: args.company ?? null,
    p_title: args.title ?? null,
    p_location: args.location ?? null,
  } as never);
  if (typeof dedupeKey !== "string" || dedupeKey.length === 0) return;
  await admin.rpc("register_lead", {
    p_user_id: args.userId,
    p_source: args.source,
    p_priority: args.priority,
    p_dedupe_key: dedupeKey,
    p_ref_table: "job_leads",
    p_ref_id: args.refId,
  } as never);
}
