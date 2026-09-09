// ============================================================
// Leverandørnøytral MCP-kontrakt for Karrierenmin. Ingen I/O.
//
// Ett endepunkt, ett verktøysett, identisk for ChatGPT/Codex, Claude,
// Gemini, Grok og Microsoft Copilot. Ingen leverandør har egne verktøy,
// egne felter eller egne rettigheter.
//
// HVORFOR EGEN ADAPTER OG IKKE SDK-TRANSPORTEN:
// `@modelcontextprotocol/sdk` er installert og brukes for typer, skjemaer
// og protokollkonstanter. Selve HTTP-laget er skrevet her fordi kravene
// avviker fra SDK-transportens standardoppførsel på punkter vi ikke kan
// fravike: fullstendig sesjonsløs drift (ingen Mcp-Session-Id, ingen
// DELETE-terminering), GET/DELETE som 405 med `Allow: POST, OPTIONS`,
// OAuth-autentisering med eksakt WWW-Authenticate FØR meldingen tolkes,
// og scope-kontroll per verktøy. SDK-transporten eier sin egen
// Response-generering og kan ikke gi disse svarene uendret.
// ============================================================

import type { OauthScope } from "@/lib/ai-integrations/oauth-contract";
import { AGENT_WORKFLOW_KINDS } from "@/lib/ai-integrations/claim-contract";

/** Ett offentlig, leverandørnøytralt endepunkt. */
export const MCP_ENDPOINT_PATH = "/api/public/mcp";

/** Kanonisk OAuth-resource er nøyaktig MCP-endepunktet. */
export const MCP_RESOURCE_PATH = MCP_ENDPOINT_PATH;

/**
 * Protokollversjoner vi faktisk validerer mot. `2026-07-28` finnes ikke i
 * SDK-en som er installert (1.30.0) og annonseres derfor ikke — vi later
 * ikke som om vi støtter en versjon vi ikke kan validere.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
export type McpProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Brukes når klienten ikke oppgir versjon i det hele tatt. */
export const MCP_DEFAULT_PROTOCOL_VERSION: McpProtocolVersion = "2025-06-18";
export const MCP_LATEST_PROTOCOL_VERSION: McpProtocolVersion = "2025-11-25";

export function isSupportedProtocolVersion(value: unknown): value is McpProtocolVersion {
  return (
    typeof value === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  );
}

/**
 * JSON-RPC-batch ble fjernet i 2025-06-18. Begge versjonene vi støtter er
 * dermed uten batch, og en array-body avvises alltid. Funksjonen finnes
 * likevel eksplisitt slik at regelen er versjonsstyrt, ikke skjult.
 */
export function supportsBatch(version: McpProtocolVersion): boolean {
  return version < "2025-06-18";
}

export const MCP_SERVER_INFO = {
  name: "karrierenmin",
  title: "Karrierenmin",
  version: "1.0.0",
} as const;

export const MCP_INSTRUCTIONS =
  "Karrierenmin er brukerens egen karriereplattform. `karrierenmin_status` viser " +
  "tilkoblingens status og hvilke arbeidsflyter brukeren selv har slått på. " +
  "`karrierenmin_run` kan be om en arbeidsflyt, men ingen arbeidsflyt kan startes " +
  "av en assistent i dag — verktøyet svarer alltid not_enabled eller not_available " +
  "og oppretter aldri en kjøring. Ingen verktøy leser e-post, CV-innhold eller " +
  "LinkedIn-data.";

/** 256 KiB målt i UTF-8-byte. */
export const MCP_MAX_BODY_BYTES = 256 * 1024;

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export const MCP_TOOL_NAMES = ["karrierenmin_status", "karrierenmin_run"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export function isMcpToolName(value: unknown): value is McpToolName {
  return typeof value === "string" && (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

/** Scope kreves per verktøy, ikke bare for endepunktet. */
export const MCP_TOOL_SCOPE: Record<McpToolName, OauthScope> = {
  karrierenmin_status: "karriere.status.read",
  karrierenmin_run: "karriere.workflow.run",
};

export const MCP_TOOLS = [
  {
    name: "karrierenmin_status",
    title: "Karrierenmin: status",
    description:
      "Henter status for brukerens Karrierenmin-tilkobling: leverandør, status, " +
      "driftsform, bekreftede egenskaper og hvilke arbeidsflyter brukeren har " +
      "slått på. Leser ingen e-post, CV-data eller LinkedIn-data.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        api_version: { type: "string" },
        integration: {
          type: "object",
          properties: {
            provider: { type: "string" },
            status: { type: "string" },
            effective_mode: { type: "string" },
            capabilities: { type: "object", additionalProperties: { type: "boolean" } },
            capabilities_verified: { type: "boolean" },
            last_verified_at: { type: ["string", "null"] },
          },
          required: ["provider", "status", "effective_mode", "capabilities"],
          additionalProperties: false,
        },
        workflows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              workflow_kind: { type: "string", enum: [...AGENT_WORKFLOW_KINDS] },
              enabled_by_user: { type: "boolean" },
              available: { type: "boolean" },
            },
            required: ["workflow_kind", "enabled_by_user", "available"],
            additionalProperties: false,
          },
        },
      },
      required: ["api_version", "integration", "workflows"],
      additionalProperties: false,
    },
    annotations: {
      title: "Karrierenmin: status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "karrierenmin_run",
    title: "Karrierenmin: be om arbeidsflyt",
    description:
      "Ber om en av brukerens allowlistede arbeidsflyter. Ingen arbeidsflyt kan " +
      "startes av en assistent i dag: verktøyet svarer not_enabled hvis brukeren " +
      "ikke har slått den på, ellers not_available. Det oppretter aldri en kjøring " +
      "og skal aldri fremstilles som en utført jobb.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_kind: {
          type: "string",
          enum: [...AGENT_WORKFLOW_KINDS],
          description: "Hvilken arbeidsflyt forespørselen gjelder.",
        },
      },
      required: ["workflow_kind"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean", enum: [false] },
        workflow_kind: { type: "string", enum: [...AGENT_WORKFLOW_KINDS] },
        error: {
          type: "object",
          properties: {
            code: { type: "string", enum: ["not_enabled", "not_available"] },
            message: { type: "string" },
          },
          required: ["code", "message"],
          additionalProperties: false,
        },
      },
      required: ["ok", "workflow_kind", "error"],
      additionalProperties: false,
    },
    annotations: {
      title: "Karrierenmin: be om arbeidsflyt",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

/**
 * Accept-kravet i spesifikasjonen. Vi svarer alltid med JSON, men en klient
 * som ikke kan ta imot JSON kan ikke snakke med serveren i det hele tatt.
 */
export function acceptsJson(header: string | null): boolean {
  const value = (header ?? "").trim();
  if (value === "") return false;
  return value
    .split(",")
    .map((part) => (part.split(";")[0] ?? "").trim().toLowerCase())
    .some((type) => type === "application/json" || type === "application/*" || type === "*/*");
}

export function isJsonContentType(header: string | null): boolean {
  const value = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return value === "application/json";
}

/**
 * DNS-rebinding: en nettleserklient på et annet opphav slippes ikke inn.
 * Klienter uten Origin (desktop, CLI, serverside) er tillatt — de er ikke
 * utsatt for rebinding.
 */
export function isAllowedOrigin(origin: string | null, appOrigin: string): boolean {
  if (origin === null || origin.trim() === "" || origin === "null") return true;
  return origin === appOrigin;
}
