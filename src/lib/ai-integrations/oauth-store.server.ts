// ============================================================
// Databaseoppslag for OAuth — server-only.
//
// Adminklienten lastes alltid inne i funksjonen, aldri på modulnivå,
// slik at den ikke kan havne i klientbundelen.
// ============================================================

import type { ClientRecord } from "@/lib/ai-integrations/oauth-request";

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadClient(clientId: string): Promise<ClientRecord | null> {
  const db = await admin();
  const { data } = await db
    .from("oauth_clients")
    .select(
      "id, client_id, client_name, client_type, is_active, redirect_uris, allowed_scopes, registration_method, metadata_url, expires_at",
    )

    .eq("client_id", clientId)
    .maybeSingle();
  return (data as ClientRecord | null) ?? null;
}

/**
 * Klientoppslag for authorize- og tokenflyten. Er client_id en https-URL,
 * behandles den som et Client ID Metadata Document (CIMD) og valideres /
 * revalideres mot den tillatte vertspolicyen. Ellers er det et vanlig
 * forhåndsregistrert eller DCR-registrert client_id.
 */
export async function loadClientForRequest(clientId: string): Promise<ClientRecord | null> {
  if (clientId.startsWith("https://")) {
    const { resolveCimdClient } = await import("@/lib/ai-integrations/oauth-cimd.server");
    const result = await resolveCimdClient(clientId);
    return result.ok ? result.client : null;
  }
  const client = await loadClient(clientId);
  if (!client) return null;
  // Utløpt DCR-klient er ubrukelig, selv om is_active ennå ikke er ryddet.
  const row = client as ClientRecord & { expires_at?: string | null };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return client;
}

/** Aktive integrasjoner brukeren kan koble klienten til. */
export async function eligibleIntegrations(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("ai_integrations")
    .select("id, provider, status, effective_mode")
    .eq("user_id", userId)
    // Kun integrasjoner som faktisk kan autorisere: connecting eller active.
    .in("status", ["connecting", "active"])
    .order("updated_at", { ascending: false });
  return (data ?? []) as Array<{
    id: string;
    provider: string;
    status: string;
    effective_mode: string;
  }>;
}

export async function isRevoked(jti: string, grantId: string): Promise<boolean> {
  const db = await admin();
  const { data } = await db
    .from("oauth_access_token_revocations")
    .select("id")
    .or(`jti.eq.${jti},grant_id.eq.${grantId}`)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
