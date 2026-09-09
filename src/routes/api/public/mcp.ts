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
// Logging: verken token, body, argumenter eller feilinnhold logges.
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import {
  JSONRPC_INVALID_REQUEST,
  JSONRPC_PARSE_ERROR,
  MCP_MAX_BODY_BYTES,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  acceptsJson,
  isAllowedOrigin,
  isJsonContentType,
  isSupportedProtocolVersion,
  type McpProtocolVersion,
} from "@/lib/ai-integrations/mcp-contract";

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function corsHeaders(origin: string | null, appOrigin: string): Record<string, string> {
  if (!origin || origin !== appOrigin) return {};
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

async function handlePost(request: Request): Promise<Response> {
  const { publicAppOrigin, oauthUrls } = await import("@/lib/ai-integrations/oauth-config.server");
  const originConfig = publicAppOrigin();
  if (!originConfig.ok) return json({ error: "server_error" }, 500);
  const appOrigin = originConfig.origin;
  const urls = oauthUrls(appOrigin);
  const cors = corsHeaders(request.headers.get("origin"), appOrigin);

  // --- Transport-herding -------------------------------------------------
  if (!isAllowedOrigin(request.headers.get("origin"), appOrigin)) {
    return json({ error: "forbidden_origin" }, 403, cors);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return json({ error: "unsupported_media_type" }, 415, cors);
  }
  if (!acceptsJson(request.headers.get("accept"))) {
    return json({ error: "not_acceptable" }, 406, cors);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413, cors);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MCP_MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413, cors);
  }

  // --- Autentisering før innholdet tolkes --------------------------------
  const { authenticateOauthRequest } = await import("@/lib/ai-integrations/oauth-auth.server");
  const auth = await authenticateOauthRequest(request, null);
  if (!auth.ok) {
    if (auth.status === 500) return json({ error: "server_error" }, 500, cors);
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
    return rpcErrorResponse(400, JSONRPC_PARSE_ERROR, "Kunne ikke tolke JSON.", cors);
  }

  if (Array.isArray(parsed)) {
    // Batch ble fjernet i 2025-06-18. Ingen støttet versjon tillater det.
    return rpcErrorResponse(
      400,
      JSONRPC_INVALID_REQUEST,
      "JSON-RPC-batch støttes ikke i denne protokollversjonen.",
      cors,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    return rpcErrorResponse(400, JSONRPC_INVALID_REQUEST, "Forventet et JSON-RPC-objekt.", cors);
  }

  const message = parsed as Record<string, unknown>;
  const id = message["id"];
  const hasValidId = typeof id === "string" || typeof id === "number";
  if (message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return rpcErrorResponse(400, JSONRPC_INVALID_REQUEST, "Ugyldig JSON-RPC-melding.", cors);
  }
  if (id !== undefined && id !== null && !hasValidId) {
    return rpcErrorResponse(400, JSONRPC_INVALID_REQUEST, "Ugyldig id.", cors);
  }

  const { dispatchMcpMessage } = await import("@/lib/ai-integrations/mcp-server.server");
  const outgoing = await dispatchMcpMessage(
    {
      jsonrpc: "2.0",
      ...(hasValidId ? { id: id as string | number } : {}),
      method: message["method"] as string,
      params: message["params"],
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
  return json(outgoing, 200, cors);
}

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
      OPTIONS: async ({ request }) => {
        const { publicAppOrigin } = await import("@/lib/ai-integrations/oauth-config.server");
        const origin = publicAppOrigin();
        const cors = origin.ok ? corsHeaders(request.headers.get("origin"), origin.origin) : {};
        return new Response(null, {
          status: 204,
          headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store", ...cors },
        });
      },
    },
  },
});
