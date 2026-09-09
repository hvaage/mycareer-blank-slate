// ============================================================
// Delt domenelag for agent-API-et — server-only.
//
// Både REST-kompatibilitetsrutene (/api/public/ai-integrations/v1/*) og
// MCP-transporten (/api/public/mcp) bruker NØYAKTIG disse funksjonene.
// Autorisasjon skjer i kalleren; her leses bare data som er bundet til en
// allerede verifisert bruker-/integrasjons-id. Ingenting leses fra
// forespørselens body.
//
// Svarene inneholder aldri e-post, CV-innhold, LinkedIn-data eller nøkler.
// ============================================================

import {
  AGENT_WORKFLOW_KINDS,
  WORKFLOW_PREFERENCE_KEY,
  type AgentWorkflowKind,
} from "@/lib/ai-integrations/claim-contract";
import type { AiCapabilities, AiProvider } from "@/lib/ai-integrations/contract";

export type WorkflowView = {
  workflow_kind: AgentWorkflowKind;
  enabled_by_user: boolean;
  /** Ingen arbeidsflyt kan startes av en assistent ennå. */
  available: boolean;
};

export type IntegrationView = {
  id: string;
  userId: string;
  provider: AiProvider;
  status: string;
  effectiveMode: string;
  capabilities: AiCapabilities;
  lastVerifiedAt: string | null;
};

export type StatusPayload = {
  ok: true;
  api_version: "v1";
  integration: {
    provider: AiProvider;
    status: string;
    effective_mode: string;
    capabilities: AiCapabilities;
    /** Capabilities settes aldri av en klientpåstand. */
    capabilities_verified: boolean;
    last_verified_at: string | null;
  };
  workflows: WorkflowView[];
};

export type RunResult = {
  ok: false;
  workflow_kind: AgentWorkflowKind;
  error: { code: "not_enabled" | "not_available"; message: string };
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function readPreferences(userId: string): Promise<Record<string, boolean | undefined>> {
  const db = await admin();
  const { data } = await db
    .from("automation_preferences")
    .select(
      "job_email_import_enabled, career_email_suggestions_enabled, linkedin_ready_detection_enabled",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (data ?? {}) as Record<string, boolean | undefined>;
}

/** Brukerens arbeidsflyter. `available` er alltid false i denne fasen. */
export async function loadWorkflows(userId: string): Promise<WorkflowView[]> {
  const prefs = await readPreferences(userId);
  return AGENT_WORKFLOW_KINDS.map((kind) => ({
    workflow_kind: kind,
    enabled_by_user: prefs[WORKFLOW_PREFERENCE_KEY[kind]] === true,
    available: false,
  }));
}

/**
 * Slår opp integrasjonen på en allerede verifisert id. Brukes av MCP, der
 * identiteten kommer fra OAuth-tokenet. Returnerer null hvis raden mangler
 * eller ikke eies av samme bruker — fail closed.
 */
export async function loadIntegrationById(
  integrationId: string,
  userId: string,
): Promise<IntegrationView | null> {
  const db = await admin();
  const { data } = await db
    .from("ai_integrations")
    .select("id, user_id, provider, status, effective_mode, capabilities, last_verified_at")
    .eq("id", integrationId)
    .maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    provider: data.provider as AiProvider,
    status: data.status as string,
    effectiveMode: data.effective_mode as string,
    capabilities: (data.capabilities ?? {}) as AiCapabilities,
    lastVerifiedAt: (data.last_verified_at as string | null) ?? null,
  };
}

export function buildStatusPayload(
  integration: IntegrationView,
  workflows: WorkflowView[],
): StatusPayload {
  return {
    ok: true,
    api_version: "v1",
    integration: {
      provider: integration.provider,
      status: integration.status,
      effective_mode: integration.effectiveMode,
      capabilities: integration.capabilities,
      capabilities_verified: false,
      last_verified_at: integration.lastVerifiedAt,
    },
    workflows,
  };
}

export async function getStatus(integration: IntegrationView): Promise<StatusPayload> {
  return buildStatusPayload(integration, await loadWorkflows(integration.userId));
}

/**
 * Ber om en arbeidsflyt. Oppretter ALDRI en kjøring og påstår aldri at noe
 * ble utført. Er arbeidsflyten avslått av brukeren, sier vi det; ellers at
 * funksjonen ikke finnes som agentutløst kjøring ennå.
 */
export async function requestWorkflowRun(
  userId: string,
  kind: AgentWorkflowKind,
): Promise<RunResult> {
  const prefs = await readPreferences(userId);
  if (prefs[WORKFLOW_PREFERENCE_KEY[kind]] !== true) {
    return {
      ok: false,
      workflow_kind: kind,
      error: {
        code: "not_enabled",
        message: "Brukeren har ikke slått på denne arbeidsflyten.",
      },
    };
  }
  return {
    ok: false,
    workflow_kind: kind,
    error: {
      code: "not_available",
      message: "Arbeidsflyten kan ikke startes av en assistent ennå. Ingen kjøring ble opprettet.",
    },
  };
}

/** HTTP-status REST-laget bruker for hver feilkode. MCP bruker ikke denne. */
export const RUN_ERROR_HTTP_STATUS: Record<RunResult["error"]["code"], number> = {
  not_enabled: 403,
  not_available: 501,
};
