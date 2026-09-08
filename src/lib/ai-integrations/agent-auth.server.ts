// ============================================================
// Autentisering av agentkall — server-only.
//
// Verifiserer signatur, audience, utløp og leverandør på
// integrasjonstokenet, og slår DERETTER opp at integrasjonen fortsatt
// er brukbar (active/degraded). Frakobling tilbakekaller derfor tilgang
// umiddelbart, uten at tokenet må trekkes tilbake separat.
//
// Bruker-id og integrasjons-id kommer utelukkende fra tokenet.
// ============================================================

import { verifyAgentToken } from "@/lib/ai-integrations/token.server";
import { isAgentUsableStatus } from "@/lib/ai-integrations/claim-contract";
import type { AiCapabilities, AiProvider } from "@/lib/ai-integrations/contract";

export function agentFail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export type AgentIntegration = {
  id: string;
  userId: string;
  provider: AiProvider;
  status: string;
  effectiveMode: string;
  capabilities: AiCapabilities;
  lastVerifiedAt: string | null;
};

export type AgentAuthResult = { error: Response } | { integration: AgentIntegration };

export async function authenticateAgentRequest(request: Request): Promise<AgentAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { error: agentFail(401, "unauthorized", "Mangler gyldig integrasjonstoken.") };
  }
  const token = header.slice("Bearer ".length).trim();

  const verified = await verifyAgentToken(token);
  if (!verified.ok) {
    if (verified.reason === "not_configured") {
      return { error: agentFail(500, "server_misconfigured", "Backend er ikke ferdig satt opp.") };
    }
    // Samme svar for feil signatur, feil audience og utløpt token.
    return { error: agentFail(401, "unauthorized", "Mangler gyldig integrasjonstoken.") };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ai_integrations")
    .select("id, user_id, provider, status, effective_mode, capabilities, last_verified_at")
    .eq("id", verified.payload.iid)
    .maybeSingle();

  if (!data || data.provider !== verified.payload.provider || data.user_id !== verified.payload.sub) {
    return { error: agentFail(401, "unauthorized", "Mangler gyldig integrasjonstoken.") };
  }
  if (!isAgentUsableStatus(data.status)) {
    return { error: agentFail(403, "integration_inactive", "Integrasjonen er ikke aktiv.") };
  }

  return {
    integration: {
      id: data.id as string,
      userId: data.user_id as string,
      provider: data.provider as AiProvider,
      status: data.status as string,
      effectiveMode: data.effective_mode as string,
      capabilities: (data.capabilities ?? {}) as AiCapabilities,
      lastVerifiedAt: (data.last_verified_at as string | null) ?? null,
    },
  };
}
