// ============================================================
// POST /api/public/mcp — Streamable HTTP MCP-transport.
//
// Ett leverandørnøytralt endepunkt for ChatGPT/Codex, Claude, Gemini,
// Grok og Microsoft Copilot. Identisk verktøysett for alle fem.
//
// Sesjonsløs: ingen sesjonsheader, ingen sesjonstabell, ingen SSE-strøm.
// Hver forespørsel autentiseres på nytt med et OAuth 2.1-access token
// bundet til nøyaktig denne ressursen.
//
// Rekkefølgen er bevisst: metode -> transport-herding -> autentisering ->
// protokollversjon -> JSON-RPC. Ingenting av innholdet tolkes før kallet
// er autentisert.
//
// Logging: verken token, body, argumenter eller feilinnhold logges. Ytre
// feilgrense svarer generisk og lekker aldri stack, DB-tekst eller innhold.
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_PARSE_ERROR,
  MCP_MAX_BODY_BYTES,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  acceptsStreamableHttp,
  hasOriginHeader,
  isAllowedOrigin,
  isJsonContentType,
  isSupportedProtocolVersion,
  parseJsonRpcMessage,
  type McpProtocolVersion,
} from "@/lib/ai-integrations/mcp-contract";

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function corsHeaders(origin: string | null, appOrigin: string): Record<string, string> {
  if (origin === null || origin !== appOrigin) return {};
  return {
    "Access-Control-Allow-Origin": appOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

function rpcErrorResponse(
  status: number,
  code: number,
  message: string,
  extra: Record<string, string> = {},
): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, extra);
}

function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" });
}

/**
 * Server-only observabilitet. Kun stabile, trygge felt: hvorfor kallet ble
 * avvist, hvilken JSON-RPC-metode det gjaldt og hvilken protokollversjon som
 * ble forhandlet. Aldri token, headere, body, argumenter, id-er eller
 * feiltekst fra databasen. Vellykkede kall logges ikke.
 */
export function buildMcpRejectionLog(
  reason: string,
  method?: string,
  jsonrpcCode?: number,
  protocolVersion?: string,
): Record<string, unknown> {
  return {
    event: "mcp_request_rejected",
    reason,
    ...(method === undefined ? {} : { method }),
    ...(jsonrpcCode === undefined ? {} : { jsonrpc_code: jsonrpcCode }),
    ...(protocolVersion === undefined ? {} : { protocol_version: protocolVersion }),
  };
}

function logMcpRejected(
  reason: string,
  method?: string,
  jsonrpcCode?: number,
  protocolVersion?: string,
): void {
  console.error(JSON.stringify(buildMcpRejectionLog(reason, method, jsonrpcCode, protocolVersion)));
}

async function handlePost(request: Request): Promise<Response> {
  const { publicAppOrigin, oauthUrls } = await import("@/lib/ai-integrations/oauth-config.server");
  const originConfig = publicAppOrigin();
  if (!originConfig.ok) return json({ error: "server_error" }, 500);
  const appOrigin = originConfig.origin;
  const urls = oauthUrls(appOrigin);
  const requestOrigin = request.headers.get("origin");
  const cors = corsHeaders(requestOrigin, appOrigin);

  // --- Transport-herding -------------------------------------------------
  // Manglende Origin er tillatt (ikke-nettleserklienter). «null» og fremmede
  // opphav avvises.
  if (!isAllowedOrigin(requestOrigin, appOrigin)) {
    logMcpRejected("forbidden_origin");
    return json({ error: "forbidden_origin" }, 403);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    logMcpRejected("unsupported_media_type");
    return json({ error: "unsupported_media_type" }, 415, cors);
  }
  if (!acceptsStreamableHttp(request.headers.get("accept"))) {
    logMcpRejected("not_acceptable");
    return json({ error: "not_acceptable" }, 406, cors);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_BODY_BYTES) {
    logMcpRejected("payload_too_large");
    return json({ error: "payload_too_large" }, 413, cors);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MCP_MAX_BODY_BYTES) {
    logMcpRejected("payload_too_large");
    return json({ error: "payload_too_large" }, 413, cors);
  }

  // --- Autentisering før innholdet tolkes --------------------------------
  const { authenticateOauthRequest } = await import("@/lib/ai-integrations/oauth-auth.server");
  const auth = await authenticateOauthRequest(request, null);
  if (!auth.ok) {
    if (auth.status === 500) return json({ error: "server_error" }, 500, cors);
    logMcpRejected("invalid_token");
    return json({ error: auth.error }, 401, {
      ...cors,
      "WWW-Authenticate":
        `Bearer realm="karrierenmin", error="invalid_token", ` +
        `resource_metadata="${appOrigin}/.well-known/oauth-protected-resource${urls.resourcePath}"`,
    });
  }

  // --- Protokollversjon --------------------------------------------------
  const header = request.headers.get("mcp-protocol-version");
  if (header !== null && !isSupportedProtocolVersion(header)) {
    logMcpRejected("unsupported_protocol_version");
    return json(
      {
        error: "unsupported_protocol_version",
        supported: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
      },
      400,
      cors,
    );
  }

  const protocolVersion: McpProtocolVersion = isSupportedProtocolVersion(header)
    ? header
    : MCP_DEFAULT_PROTOCOL_VERSION;

  // --- JSON-RPC ----------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logMcpRejected("parse_error");
    return rpcErrorResponse(400, JSONRPC_PARSE_ERROR, "Kunne ikke tolke JSON.", cors);
  }

  // Konvolutten valideres med SDK-ens Zod-skjemaer. id: null er ugyldig.
  const message = parseJsonRpcMessage(parsed);
  if (message.kind === "invalid") {
    logMcpRejected("invalid_envelope");
    return rpcErrorResponse(400, message.code, message.message, cors);
  }

  const { dispatchMcpMessage } = await import("@/lib/ai-integrations/mcp-server.server");
  const outgoing = await dispatchMcpMessage(
    {
      jsonrpc: "2.0",
      ...(message.kind === "request" ? { id: message.id } : {}),
      method: message.method,
      params: message.params,
    },
    {
      userId: auth.userId,
      integrationId: auth.integrationId,
      scopes: auth.scopes,
      protocolVersion,
    },
  );

  // Notifikasjon: ingen body.
  if (outgoing === null) {
    return new Response(null, {
      status: 202,
      headers: { "Cache-Control": "no-store", ...cors },
    });
  }
  // Kun feil logges. Vellykkede kall gir ingen ny loggstøy.
  if ("error" in outgoing) {
    logMcpRejected("jsonrpc_error", message.method, outgoing.error.code, protocolVersion);
  }
  return json(outgoing, 200, cors);
}

/** Ytre fail-closed grense: ingen stack, token, body eller DB-tekst ut. */
async function safeHandlePost(request: Request): Promise<Response> {
  try {
    return await handlePost(request);
  } catch {
    return rpcErrorResponse(500, JSONRPC_INTERNAL_ERROR, "Intern feil.");
  }
}

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => safeHandlePost(request),
      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
      OPTIONS: async ({ request }) => {
        try {
          const { publicAppOrigin } = await import("@/lib/ai-integrations/oauth-config.server");
          const config = publicAppOrigin();
          const requestOrigin = request.headers.get("origin");
          const appOrigin = config.ok ? config.origin : null;
          if (appOrigin && !isAllowedOrigin(requestOrigin, appOrigin)) {
            return json({ error: "forbidden_origin" }, 403);
          }
          const cors =
            appOrigin && hasOriginHeader(requestOrigin)
              ? corsHeaders(requestOrigin, appOrigin)
              : {};
          return new Response(null, {
            status: 204,
            headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store", ...cors },
          });
        } catch {
          return json({ error: "server_error" }, 500);
        }
      },
    },
  },
});
