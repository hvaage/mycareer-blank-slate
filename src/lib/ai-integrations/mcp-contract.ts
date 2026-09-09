// ============================================================
// Leverandørnøytral MCP-kontrakt for Karrierenmin.
//
// Ett endepunkt, ett verktøysett, identisk for ChatGPT/Codex, Claude,
// Gemini, Grok og Microsoft Copilot. Ingen leverandør har egne verktøy,
// egne felter eller egne rettigheter.
//
// HVA FRA `@modelcontextprotocol/sdk@1.30.0` SOM FAKTISK BRUKES:
// Zod-skjemaene under er i kjørebanen for hver eneste forespørsel:
//   - `JSONRPCRequestSchema`      — validerer request-konvolutten
//   - `JSONRPCNotificationSchema` — validerer notifikasjonskonvolutten
//   - `RequestIdSchema`           — RequestId er string | integer, aldri null
//   - `InitializeRequestSchema`   — validerer initialize-params
//   - `ListToolsRequestSchema`    — validerer tools/list-params
//   - `CallToolRequestSchema`     — validerer tools/call-params
//   - `PingRequestSchema`         — validerer ping
//   - `SUPPORTED_PROTOCOL_VERSIONS` — versjonsliste vi kontrollerer mot
//   - `LATEST_PROTOCOL_VERSION`     — velger nyeste versjon vi annonserer
//
// HVA SOM IKKE BRUKES, OG HVORFOR:
// SDK-ens `Server`/`McpServer` og `WebStandardStreamableHTTPServerTransport`
// er ikke i bruk. Transporten eier sin egen Response-generering og kan ikke
// gi svarene kravene stiller: fullstendig sesjonsløs drift (ingen
// Mcp-Session-Id, ingen DELETE-terminering), GET/DELETE som 405 med
// `Allow: POST, OPTIONS`, OAuth-autentisering med eksakt `WWW-Authenticate`
// FØR meldingen tolkes, og scope-kontroll per verktøy. HTTP-laget er derfor
// vår egen adapter, mens all protokollvalidering er SDK-ens.
// SDK-ens AJV-validator brukes ikke i kjørebanen (verktøyskjemaene er
// statiske og validert i test) — kun i testene.
// ============================================================

import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  RequestIdSchema,
  SUPPORTED_PROTOCOL_VERSIONS as SDK_SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION as SDK_LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import type { OauthScope } from "@/lib/ai-integrations/oauth-contract";
import { AGENT_WORKFLOW_KINDS } from "@/lib/ai-integrations/claim-contract";

/** Ett offentlig, leverandørnøytralt endepunkt. */
export const MCP_ENDPOINT_PATH = "/api/public/mcp";

/** Kanonisk OAuth-resource er nøyaktig MCP-endepunktet. */
export const MCP_RESOURCE_PATH = MCP_ENDPOINT_PATH;

/**
 * Protokollversjoner vi faktisk validerer mot. Begge finnes i SDK-ens
 * `SUPPORTED_PROTOCOL_VERSIONS`. `2026-07-28` annonseres ikke — den finnes
 * ikke i SDK-en og vi later ikke som om vi kan validere den.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
export type McpProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Sannhetskontroll mot SDK-en: vi annonserer aldri en versjon SDK-en ikke kjenner. */
export function isKnownBySdk(version: string): boolean {
  return (SDK_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Brukes når klienten ikke oppgir versjon i det hele tatt. */
export const MCP_DEFAULT_PROTOCOL_VERSION: McpProtocolVersion = "2025-06-18";
/**
 * Nyeste versjon vi annonserer. SDK-ens `LATEST_PROTOCOL_VERSION` brukes bare
 * når den også finnes i vår egen støtteliste — vi annonserer aldri en versjon
 * vi ikke validerer selv.
 */
export const MCP_LATEST_PROTOCOL_VERSION: McpProtocolVersion = isSupportedProtocolVersion(
  SDK_LATEST_PROTOCOL_VERSION,
)
  ? SDK_LATEST_PROTOCOL_VERSION
  : "2025-06-18";

export function isSupportedProtocolVersion(value: unknown): value is McpProtocolVersion {
  return (
    typeof value === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  );
}

/**
 * JSON-RPC-batch ble fjernet i 2025-06-18. Begge versjonene vi støtter er
 * dermed uten batch, og en array-body avvises alltid.
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
          // Alle feltene returneres alltid.
          required: [
            "provider",
            "status",
            "effective_mode",
            "capabilities",
            "capabilities_verified",
            "last_verified_at",
          ],
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

// ---------------------------------------------------------------
// Accept-forhandling
// ---------------------------------------------------------------

type MediaRange = { type: string; subtype: string; q: number; explicitQ: boolean; valid: boolean };

/**
 * Tolker Accept fail-closed: en eksplisitt q-parameter må være syntaktisk
 * gyldig RFC 9110-kvalitet i [0,1]. Er den ikke det, er hele media-rangen
 * ubrukelig (`valid: false`) — den regnes aldri som akseptert.
 */
export function parseAcceptHeader(header: string | null): MediaRange[] {
  const value = (header ?? "").trim();
  if (value === "") return [];
  const ranges: MediaRange[] = [];
  for (const part of value.split(",")) {
    const segments = part.split(";");
    const media = (segments[0] ?? "").trim().toLowerCase();
    if (media === "") continue;
    const [type, subtype] = media.split("/");
    if (!type || !subtype) continue;
    let q = 1;
    let explicitQ = false;
    let valid = true;
    for (const param of segments.slice(1)) {
      const [rawKey, rawValue] = param.split("=");
      if ((rawKey ?? "").trim().toLowerCase() !== "q") continue;
      explicitQ = true;
      const raw = (rawValue ?? "").trim();
      // RFC 9110: qvalue = ( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] )
      if (!/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(raw)) {
        valid = false;
        q = 0;
        continue;
      }
      q = Number(raw);
    }
    ranges.push({ type, subtype, q, explicitQ, valid });
  }
  return ranges;
}

/** Sann bare når klienten faktisk aksepterer medietypen med gyldig q > 0. */
export function acceptsMediaType(header: string | null, mediaType: string): boolean {
  const [wantType, wantSubtype] = mediaType.toLowerCase().split("/");
  const ranges = parseAcceptHeader(header);
  if (ranges.length === 0) return false;
  // Mest spesifikke match vinner: eksakt -> type/* -> */*
  const exact = ranges.find((r) => r.type === wantType && r.subtype === wantSubtype);
  if (exact) return exact.valid && exact.q > 0;
  const subtypeWildcard = ranges.find((r) => r.type === wantType && r.subtype === "*");
  if (subtypeWildcard) return subtypeWildcard.valid && subtypeWildcard.q > 0;
  const wildcard = ranges.find((r) => r.type === "*" && r.subtype === "*");
  if (wildcard) return wildcard.valid && wildcard.q > 0;
  return false;
}

/** Sann bare ved en EKSPLISITT media-range for typen, med gyldig q > 0. */
function acceptsMediaTypeExplicitly(ranges: MediaRange[], mediaType: string): boolean {
  const [wantType, wantSubtype] = mediaType.toLowerCase().split("/");
  const exact = ranges.find((r) => r.type === wantType && r.subtype === wantSubtype);
  return exact !== undefined && exact.valid && exact.q > 0;
}

/**
 * Streamable HTTP (2025-06-18 og 2025-11-25) krever at POST tilbyr BÅDE
 * `application/json` og `text/event-stream` EKSPLISITT. Wildcard alene
 * (full wildcard eller typewildcard) er ikke nok.
 */
export function acceptsStreamableHttp(header: string | null): boolean {
  const ranges = parseAcceptHeader(header);
  return (
    acceptsMediaTypeExplicitly(ranges, "application/json") &&
    acceptsMediaTypeExplicitly(ranges, "text/event-stream")
  );
}

export function isJsonContentType(header: string | null): boolean {
  const value = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return value === "application/json";
}

/**
 * DNS-rebinding: en nettleserklient på et annet opphav slippes ikke inn.
 * Klienter uten Origin-header (desktop, CLI, serverside) er tillatt — de er
 * ikke utsatt for rebinding. Enhver TILSTEDEVÆRENDE verdi — inkludert tom
 * streng, whitespace og `null` — må være eksakt PUBLIC_APP_ORIGIN.
 */
export function isAllowedOrigin(origin: string | null, appOrigin: string): boolean {
  if (origin === null) return true;
  return origin === appOrigin;
}

/** Sann når klienten sendte en Origin-header i det hele tatt. */
export function hasOriginHeader(origin: string | null): boolean {
  return origin !== null;
}

// ---------------------------------------------------------------
// JSON-RPC-konvolutt, validert med SDK-ens skjemaer
// ---------------------------------------------------------------

export type ParsedIncoming =
  | { kind: "request"; id: string | number; method: string; params?: unknown }
  | { kind: "notification"; method: string; params?: unknown }
  | { kind: "invalid"; code: number; message: string };

/**
 * Validerer konvolutten med SDK-ens Zod-skjemaer. `id: null` er IKKE en
 * notifikasjon: MCP RequestId er string | integer, og null avvises som
 * ugyldig forespørsel. Fravær av `id` er notifikasjon.
 */
export function parseJsonRpcMessage(parsed: unknown): ParsedIncoming {
  if (Array.isArray(parsed)) {
    return {
      kind: "invalid",
      code: JSONRPC_INVALID_REQUEST,
      message: "JSON-RPC-batch støttes ikke i denne protokollversjonen.",
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      kind: "invalid",
      code: JSONRPC_INVALID_REQUEST,
      message: "Forventet et JSON-RPC-objekt.",
    };
  }
  const record = parsed as Record<string, unknown>;

  if ("id" in record) {
    if (!RequestIdSchema.safeParse(record["id"]).success) {
      return {
        kind: "invalid",
        code: JSONRPC_INVALID_REQUEST,
        message: "Ugyldig id: MCP krever en streng eller et heltall.",
      };
    }
    const result = JSONRPCRequestSchema.safeParse(record);
    if (!result.success) {
      return {
        kind: "invalid",
        code: JSONRPC_INVALID_REQUEST,
        message: "Ugyldig JSON-RPC-melding.",
      };
    }
    const message = result.data;
    return {
      kind: "request",
      id: message.id,
      method: message.method,
      params: (message as { params?: unknown }).params,
    };
  }

  const result = JSONRPCNotificationSchema.safeParse(record);
  if (!result.success) {
    return {
      kind: "invalid",
      code: JSONRPC_INVALID_REQUEST,
      message: "Ugyldig JSON-RPC-melding.",
    };
  }
  return {
    kind: "notification",
    method: result.data.method,
    params: (result.data as { params?: unknown }).params,
  };
}

/** Params-validering per metode, også dette med SDK-ens skjemaer. */
export const MCP_METHOD_SCHEMAS = {
  initialize: InitializeRequestSchema,
  ping: PingRequestSchema,
  "tools/list": ListToolsRequestSchema,
  "tools/call": CallToolRequestSchema,
} as const;

export function validateMethodParams(
  method: keyof typeof MCP_METHOD_SCHEMAS,
  params: unknown,
): { ok: true; params: Record<string, unknown> } | { ok: false } {
  const result = MCP_METHOD_SCHEMAS[method].safeParse({
    method,
    ...(params === undefined ? {} : { params }),
  });
  if (!result.success) return { ok: false };
  return {
    ok: true,
    params: ((result.data as { params?: unknown }).params ?? {}) as Record<string, unknown>,
  };
}
