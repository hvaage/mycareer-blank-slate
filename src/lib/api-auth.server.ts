// ============================================================
// Delt pålogging for server-ruter under /api.
//
// Samme kontrakt som /api/linkedin/imports: Bearer-token verifiseres
// mot Supabase Auth FØR noen databasekontakt, og bruker-id kommer
// utelukkende herfra — aldri fra forespørselens innhold.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export function apiFail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export type ApiAuthResult =
  | { error: Response }
  | { userClient: SupabaseClient; userId: string };

export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) {
    return { error: apiFail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.") };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
    return { error: apiFail(401, "unauthorized", "Mangler gyldig pålogging.") };
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data } = await userClient.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return { error: apiFail(401, "unauthorized", "Mangler gyldig pålogging.") };

  return { userClient, userId };
}
