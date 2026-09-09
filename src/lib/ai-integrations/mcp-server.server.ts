// ============================================================
// Sesjonsløs MCP-dispatch — server-only.
//
// Tar én verifisert JSON-RPC-melding og en allerede autentisert kontekst,
// og returnerer JSON-RPC-svaret (eller null for en notifikasjon).
// Ingen tilstand lagres mellom kall. Ingen sesjons-id finnes.
//
// Identiteten kommer utelukkende fra OAuth-tokenet. Verken user_id,
// integration_id eller scope leses noen gang fra meldingen.
// ============================================================

import {
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  MCP_TOOL_SCOPE,
  isMcpToolName,
  isSupportedProtocolVersion,
  MCP_LATEST_PROTOCOL_VERSION,
  type McpProtocolVersion,
  type McpToolName,
} from "@/lib/ai-integrations/mcp-contract";
import { isAgentWorkflowKind } from "@/lib/ai-integrations/claim-contract";
import {
  getStatus,
  loadIntegrationById,
  requestWorkflowRun,
} from "@/lib/ai-integrations/agent-domain.server";

export type JsonRpcId = string | number;

export type McpContext = {
  userId: string;
  integrationId: string;
  scopes: string[];
  protocolVersion: McpProtocolVersion;
};

export type JsonRpcResult = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown };
export type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
};
export type JsonRpcOutgoing = JsonRpcResult | JsonRpcError;

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResult {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** Verktøyfeil er et gyldig resultat på JSON-RPC-nivå, ikke en protokollfeil. */
function toolError(id: JsonRpcId, code: string, message: string): JsonRpcResult {
  return rpcResult(id, {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, error: { code, message } },
  });
}

function toolOk(id: JsonRpcId, structured: unknown): JsonRpcResult {
  return rpcResult(id, {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  });
}

type IncomingMessage = {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method: string;
  params?: unknown;
};

/**
 * Dispatch. Returnerer null når meldingen er en notifikasjon (uten id),
 * slik at transporten kan svare 202 uten innhold.
 */
export async function dispatchMcpMessage(
  message: IncomingMessage,
  ctx: McpContext,
): Promise<JsonRpcOutgoing | null> {
  const isNotification = message.id === undefined || message.id === null;
  const id = (message.id ?? null) as JsonRpcId | null;

  switch (message.method) {
    case "initialize": {
      if (isNotification) return null;
      const requested = (message.params as Record<string, unknown> | undefined)?.[
        "protocolVersion"
      ];
      const negotiated = isSupportedProtocolVersion(requested)
        ? requested
        : MCP_LATEST_PROTOCOL_VERSION;
      return rpcResult(id as JsonRpcId, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return isNotification ? null : rpcResult(id as JsonRpcId, {});

    case "tools/list": {
      if (isNotification) return null;
      return rpcResult(id as JsonRpcId, { tools: MCP_TOOLS });
    }

    case "tools/call": {
      if (isNotification) return null;
      return callTool(id as JsonRpcId, message.params, ctx);
    }

    default:
      if (isNotification) return null;
      return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Ukjent metode: ${message.method}`);
  }
}

async function callTool(id: JsonRpcId, params: unknown, ctx: McpContext): Promise<JsonRpcOutgoing> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "params må være et objekt.");
  }
  const record = params as Record<string, unknown>;
  const name = record["name"];
  if (!isMcpToolName(name)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Ukjent verktøy.");
  }
  const args = record["arguments"];
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "arguments må være et objekt.");
  }
  const input = (args ?? {}) as Record<string, unknown>;

  // Scope per verktøy. Manglende scope er en verktøyfeil (HTTP 200), ikke 401.
  const requiredScope = MCP_TOOL_SCOPE[name as McpToolName];
  if (!ctx.scopes.includes(requiredScope)) {
    return toolError(
      id,
      "insufficient_scope",
      `Tilgangen mangler scope «${requiredScope}». Brukeren må godkjenne dette på nytt.`,
    );
  }

  // Integrasjonen må fortsatt eies av tokenets bruker.
  const integration = await loadIntegrationById(ctx.integrationId, ctx.userId);
  if (!integration) {
    return toolError(id, "integration_inactive", "Integrasjonen er ikke tilgjengelig lenger.");
  }

  if (name === "karrierenmin_status") {
    if (Object.keys(input).length > 0) {
      return rpcError(id, JSONRPC_INVALID_PARAMS, "karrierenmin_status tar ingen argumenter.");
    }
    const status = await getStatus(integration);
    return toolOk(id, {
      api_version: status.api_version,
      integration: status.integration,
      workflows: status.workflows,
    });
  }

  const kind = input["workflow_kind"];
  if (!isAgentWorkflowKind(kind)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Ukjent arbeidsflyt.");
  }
  if (Object.keys(input).some((key) => key !== "workflow_kind")) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Ukjent felt i arguments.");
  }
  const run = await requestWorkflowRun(ctx.userId, kind);
  // Alltid en verktøyfeil: ingen kjøring ble opprettet.
  return rpcResult(id, {
    isError: true,
    content: [{ type: "text", text: run.error.message }],
    structuredContent: run,
  });
}
