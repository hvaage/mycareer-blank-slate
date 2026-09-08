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
    .select("id, client_id, client_name, client_type, is_active, redirect_uris, allowed_scopes")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as ClientRecord | null) ?? null;
}

/** Aktive integrasjoner brukeren kan koble klienten til. */
export async function eligibleIntegrations(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("ai_integrations")
    .select("id, provider, status, effective_mode")
    .eq("user_id", userId)
    .neq("status", "disconnected")
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
