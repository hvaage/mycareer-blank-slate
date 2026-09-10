// ============================================================
// Streamable HTTP MCP-transporten på /api/public/mcp.
//
// Dekker HTTP-semantikk, herding, autentisering, protokollversjoner,
// JSON-RPC-feilkoder, scope per verktøy, verktøysemantikk, delt domenelag
// med REST og leverandørnøytralitet (samme svar for alle fem klienter).
// ============================================================

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_PROVIDERS } from "@/lib/ai-integrations/contract";
import {
  JSONRPC_INVALID_REQUEST,
  MCP_ENDPOINT_PATH,
  MCP_MAX_BODY_BYTES,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TOOLS,
  MCP_TOOL_SCOPE,
  acceptsMediaType,
  acceptsStreamableHttp,
  hasOriginHeader,
  isAllowedOrigin,
  isJsonContentType,
  isKnownBySdk,
  isSupportedProtocolVersion,
  parseJsonRpcMessage,
  supportsBatch,
  validateMethodParams,
} from "@/lib/ai-integrations/mcp-contract";
import { RequestIdSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { OAUTH_PATHS } from "@/lib/ai-integrations/oauth-config.server";

const ORIGIN = "https://karrierenmin.no";
const URL_MCP = `${ORIGIN}${MCP_ENDPOINT_PATH}`;

type AuthResult =
  | { ok: true; userId: string; integrationId: string; grantId: string; scopes: string[] }
  | { ok: false; status: number; error: string };

let authResult: AuthResult = {
  ok: true,
  userId: "user-1",
  integrationId: "int-1",
  grantId: "grant-1",
  scopes: ["karriere.status.read", "karriere.workflow.run"],
};

const authSpy = vi.fn();
let authThrows = false;
vi.mock("@/lib/ai-integrations/oauth-auth.server", () => ({
  authenticateOauthRequest: (request: Request, scope: string | null) => {
    authSpy(request, scope);
    if (authThrows) throw new Error("hemmelig db-tekst: token abc123");
    return Promise.resolve(authResult);
  },
}));

let preferences: Record<string, boolean> = {
  job_email_import_enabled: true,
  career_email_suggestions_enabled: false,
  linkedin_ready_detection_enabled: false,
};
let integrationRow: Record<string, unknown> | null = {
  id: "int-1",
  user_id: "user-1",
  provider: "claude",
  status: "active",
  effective_mode: "guided",
  capabilities: {},
  last_verified_at: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const value = table === "ai_integrations" ? integrationRow : preferences;
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: value, error: null }),
      };
      return builder;
    },
  },
}));

async function route() {
  const mod = await import("@/routes/api/public/mcp");
  return (
    mod.Route as unknown as {
      options: {
        server: {
          handlers: Record<string, (ctx: { request: Request }) => Promise<Response>>;
        };
      };
    }
  ).options.server.handlers;
}

async function post(
  body: unknown,
  init: { headers?: Record<string, string>; rawBody?: string } = {},
): Promise<Response> {
  const handlers = await route();
  const request = new Request(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      ...(init.headers ?? {}),
    },
    body: init.rawBody ?? JSON.stringify(body),
  });
  return handlers["POST"]!({ request });
}

function rpc(method: string, params?: unknown, id: string | number | undefined = 1) {
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    ...(params ? { params } : {}),
  };
}

beforeEach(() => {
  process.env["PUBLIC_APP_ORIGIN"] = ORIGIN;
  authResult = {
    ok: true,
    userId: "user-1",
    integrationId: "int-1",
    grantId: "grant-1",
    scopes: ["karriere.status.read", "karriere.workflow.run"],
  };
  preferences = {
    job_email_import_enabled: true,
    career_email_suggestions_enabled: false,
    linkedin_ready_detection_enabled: false,
  };
  integrationRow = {
    id: "int-1",
    user_id: "user-1",
    provider: "claude",
    status: "active",
    effective_mode: "guided",
    capabilities: {},
    last_verified_at: "2026-01-01T00:00:00.000Z",
  };
  authThrows = false;
  authSpy.mockClear();
});

describe("kanonisk ressurs og kontrakt", () => {
  it("OAuth-resource er nøyaktig MCP-endepunktet", () => {
    expect(OAUTH_PATHS.resource).toBe("/api/public/mcp");
    expect(MCP_ENDPOINT_PATH).toBe("/api/public/mcp");
  });

  it("ingen støttet protokollversjon tillater JSON-RPC-batch", () => {
    for (const version of MCP_SUPPORTED_PROTOCOL_VERSIONS) {
      expect(supportsBatch(version)).toBe(false);
    }
    expect(isSupportedProtocolVersion("2024-11-05")).toBe(false);
    expect(isSupportedProtocolVersion("2025-06-18")).toBe(true);
    expect(isSupportedProtocolVersion("2025-11-25")).toBe(true);
  });

  it("verktøyene har eksakte skjemaer, annotations og scope", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(["karrierenmin_status", "karrierenmin_run"]);
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.additionalProperties).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
      expect(typeof tool.description).toBe("string");
    }
    expect(MCP_TOOL_SCOPE["karrierenmin_status"]).toBe("karriere.status.read");
    expect(MCP_TOOL_SCOPE["karrierenmin_run"]).toBe("karriere.workflow.run");
  });

  it("headerhjelperne er strenge", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
  });

  it("Accept krever BÅDE application/json og text/event-stream eksplisitt med gyldig q>0", () => {
    expect(acceptsStreamableHttp("application/json, text/event-stream")).toBe(true);
    expect(acceptsStreamableHttp("APPLICATION/JSON, TEXT/EVENT-STREAM")).toBe(true);
    expect(acceptsStreamableHttp("application/json;q=0.9, text/event-stream;q=0.1")).toBe(true);
    expect(acceptsStreamableHttp("application/json;q=1, text/event-stream;q=1.0")).toBe(true);
    expect(acceptsStreamableHttp("application/json;q=0.001, text/event-stream")).toBe(true);
    // Wildcard alene er ikke «begge».
    expect(acceptsStreamableHttp("*/*")).toBe(false);
    expect(acceptsStreamableHttp("application/*, text/*")).toBe(false);
    expect(acceptsStreamableHttp("*/*, application/json")).toBe(false);
    // Bare én av de to typene.
    expect(acceptsStreamableHttp("application/json")).toBe(false);
    expect(acceptsStreamableHttp("text/event-stream")).toBe(false);
    // q=0 betyr «ikke akseptert».
    expect(acceptsStreamableHttp("application/json, text/event-stream;q=0")).toBe(false);
    expect(acceptsStreamableHttp("application/json;q=0, text/event-stream")).toBe(false);
    expect(acceptsStreamableHttp("*/*;q=0")).toBe(false);
    // Ugyldig q er fail-closed, ikke q=1.
    expect(acceptsStreamableHttp("application/json;q=abc, text/event-stream")).toBe(false);
    expect(acceptsStreamableHttp("application/json;q=1.1, text/event-stream")).toBe(false);
    expect(acceptsStreamableHttp("application/json;q=-0.1, text/event-stream")).toBe(false);
    expect(acceptsStreamableHttp("application/json;q=, text/event-stream")).toBe(false);
    expect(acceptsMediaType("application/json;q=abc", "application/json")).toBe(false);
    expect(acceptsMediaType("application/json;q=1.1", "application/json")).toBe(false);
    expect(acceptsStreamableHttp("text/html")).toBe(false);
    expect(acceptsStreamableHttp(null)).toBe(false);
    // Eksakt match slår wildcard.
    expect(acceptsMediaType("*/*, text/event-stream;q=0", "text/event-stream")).toBe(false);
  });

  it("Origin: kun fullstendig manglende header tillates uten eksakt match", () => {
    expect(isAllowedOrigin(null, ORIGIN)).toBe(true);
    expect(isAllowedOrigin("", ORIGIN)).toBe(false);
    expect(isAllowedOrigin("   ", ORIGIN)).toBe(false);
    expect(isAllowedOrigin("null", ORIGIN)).toBe(false);
    expect(isAllowedOrigin(` ${ORIGIN} `, ORIGIN)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", ORIGIN)).toBe(false);
    expect(isAllowedOrigin(ORIGIN, ORIGIN)).toBe(true);
    expect(hasOriginHeader(null)).toBe(false);
    expect(hasOriginHeader("")).toBe(true);
    expect(hasOriginHeader("null")).toBe(true);
  });

  it("bruker SDK-ens skjemaer i kjørebanen for konvolutten", () => {
    // id: null er ikke en notifikasjon — RequestIdSchema avviser null.
    expect(RequestIdSchema.safeParse(null).success).toBe(false);
    const invalid = parseJsonRpcMessage({ jsonrpc: "2.0", id: null, method: "ping" });
    expect(invalid).toEqual({
      kind: "invalid",
      code: JSONRPC_INVALID_REQUEST,
      message: expect.stringContaining("Ugyldig id"),
    });
    expect(parseJsonRpcMessage({ jsonrpc: "2.0", id: 7, method: "ping" })).toEqual({
      kind: "request",
      id: 7,
      method: "ping",
      params: undefined,
    });
    expect(parseJsonRpcMessage({ jsonrpc: "2.0", method: "notifications/initialized" }).kind).toBe(
      "notification",
    );
    // Feil jsonrpc-versjon avvises av SDK-skjemaet, ikke av oss.
    expect(parseJsonRpcMessage({ jsonrpc: "1.0", id: 1, method: "ping" }).kind).toBe("invalid");
    // tools/call uten name avvises av CallToolRequestSchema.
    expect(validateMethodParams("tools/call", { arguments: {} }).ok).toBe(false);
    expect(validateMethodParams("tools/call", { name: "karrierenmin_status" }).ok).toBe(true);
    // Vi annonserer bare versjoner SDK-en faktisk kjenner.
    for (const version of MCP_SUPPORTED_PROTOCOL_VERSIONS) {
      expect(isKnownBySdk(version)).toBe(true);
    }
    expect(isKnownBySdk("2026-07-28")).toBe(false);
  });

  it("begge verktøy oppgir outputSchema for det vellykkede resultatet", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.outputSchema.type).toBe("object");
      expect(Array.isArray(tool.outputSchema.required)).toBe(true);
    }
  });
});

describe("HTTP-semantikk", () => {
  it("GET og DELETE gir 405 med Allow: POST, OPTIONS", async () => {
    const handlers = await route();
    for (const method of ["GET", "DELETE"]) {
      const res = await handlers[method]!({ request: new Request(URL_MCP, { method }) });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, OPTIONS");
    }
  });

  it("OPTIONS gir 204 uten innhold", async () => {
    const handlers = await route();
    const res = await handlers["OPTIONS"]!({
      request: new Request(URL_MCP, { method: "OPTIONS" }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toBe("POST, OPTIONS");
  });

  it("svar er alltid no-store", async () => {
    const res = await post(rpc("ping"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("feil content-type gir 415 og feil accept gir 406", async () => {
    expect((await post(rpc("ping"), { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    expect((await post(rpc("ping"), { headers: { accept: "text/html" } })).status).toBe(406);
  });

  it("fremmed Origin avvises (DNS-rebinding)", async () => {
    const res = await post(rpc("ping"), { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("for stor body avvises på Content-Length og på faktiske UTF-8-byte", async () => {
    const declared = await post(rpc("ping"), {
      headers: { "content-length": String(MCP_MAX_BODY_BYTES + 1) },
    });
    expect(declared.status).toBe(413);

    // Multibyte: 2 byte per tegn.
    const huge = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "æ".repeat(200000) });
    expect(huge.length).toBeLessThan(MCP_MAX_BODY_BYTES * 2);
    const actual = await post(null, { rawBody: huge });
    expect(actual.status).toBe(413);
  });
});

describe("autentisering", () => {
  it("uten gyldig token: 401 med eksakt WWW-Authenticate resource metadata", async () => {
    authResult = { ok: false, status: 401, error: "invalid_token" };
    const res = await post(rpc("initialize"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer realm="karrierenmin", error="invalid_token", ` +
        `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/public/mcp"`,
    );
  });

  it("autentiserer før innholdet tolkes, uten å kreve et bestemt scope", async () => {
    authResult = { ok: false, status: 401, error: "invalid_token" };
    const res = await post(null, { rawBody: "{ikke json" });
    // Ugyldig JSON, men autentisering kommer først.
    expect(res.status).toBe(401);
    expect(authSpy).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("initialize og tools/list krever et gyldig token", async () => {
    authResult = { ok: false, status: 401, error: "invalid_token" };
    for (const method of ["initialize", "tools/list"]) {
      expect((await post(rpc(method))).status).toBe(401);
    }
  });
});

describe("protokoll og JSON-RPC", () => {
  const initParams = {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "testklient", version: "1.0.0" },
  };

  it("initialize forhandler versjon og oppgir serverinfo", async () => {
    const res = await post(rpc("initialize", initParams));
    const body = (await res.json()) as { result: Record<string, unknown>; id: number };
    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.result["protocolVersion"]).toBe("2025-06-18");
    expect((body.result["serverInfo"] as Record<string, string>)["name"]).toBe("karrierenmin");
  });

  it("initialize uten SDK-påkrevde params gir -32602", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2025-06-18" }));
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32602);
  });

  it("id: null avvises som ugyldig forespørsel, ikke som notifikasjon", async () => {
    const res = await post({ jsonrpc: "2.0", id: null, method: "ping" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(JSONRPC_INVALID_REQUEST);
    expect(body.error.message).toContain("Ugyldig id");
  });

  it("ukjent protokollversjon i headeren avvises med 400", async () => {
    const res = await post(rpc("ping"), { headers: { "mcp-protocol-version": "1999-01-01" } });
    expect(res.status).toBe(400);
  });

  it("parse error gir -32700", async () => {
    const res = await post(null, { rawBody: "{" });
    const body = (await res.json()) as { error: { code: number }; id: null };
    expect(body.error.code).toBe(-32700);
    expect(body.id).toBeNull();
  });

  it("batch avvises fordi ingen støttet versjon har det", async () => {
    const res = await post([rpc("ping")]);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it("ukjent metode gir -32601 og beholder id", async () => {
    const res = await post(rpc("tools/unknown", undefined, "abc"));
    const body = (await res.json()) as { error: { code: number }; id: string };
    expect(body.error.code).toBe(-32601);
    expect(body.id).toBe("abc");
  });

  it("ugyldige params gir -32602", async () => {
    const res = await post(rpc("tools/call", { name: "karrierenmin_run", arguments: {} }));
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32602);
  });

  it("gyldig notifikasjon gir 202 uten innhold", async () => {
    const res = await post(rpc("notifications/initialized", undefined, undefined));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("tools/list gir begge verktøyene", async () => {
    const res = await post(rpc("tools/list"));
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      "karrierenmin_status",
      "karrierenmin_run",
    ]);
  });
});

describe("verktøy og scope", () => {
  it("karrierenmin_status speiler brukerens preferanser", async () => {
    const res = await post(rpc("tools/call", { name: "karrierenmin_status", arguments: {} }));
    const body = (await res.json()) as {
      result: {
        isError: boolean;
        structuredContent: {
          integration: Record<string, unknown>;
          workflows: Array<{ workflow_kind: string; enabled_by_user: boolean; available: boolean }>;
        };
      };
    };
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.integration["provider"]).toBe("claude");
    expect(body.result.structuredContent.integration["capabilities_verified"]).toBe(false);
    const jobImport = body.result.structuredContent.workflows.find(
      (w) => w.workflow_kind === "job_import",
    )!;
    expect(jobImport.enabled_by_user).toBe(true);
    // Ingen arbeidsflyt er tilgjengelig som agentutløst kjøring.
    expect(body.result.structuredContent.workflows.every((w) => !w.available)).toBe(true);
    expect(validateAgainstOutputSchema("karrierenmin_status", body.result.structuredContent)).toBe(
      true,
    );
  });

  it("karrierenmin_run gir not_enabled uten å opprette en kjøring", async () => {
    const res = await post(
      rpc("tools/call", { name: "karrierenmin_run", arguments: { workflow_kind: "career_log" } }),
    );
    const body = (await res.json()) as {
      result: { isError: boolean; structuredContent: { ok: boolean; error: { code: string } } };
    };
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.ok).toBe(false);
    expect(body.result.structuredContent.error.code).toBe("not_enabled");
    expect(validateAgainstOutputSchema("karrierenmin_run", body.result.structuredContent)).toBe(
      true,
    );
  });

  it("karrierenmin_run gir not_available når brukeren har slått den på", async () => {
    const res = await post(
      rpc("tools/call", { name: "karrierenmin_run", arguments: { workflow_kind: "job_import" } }),
    );
    const body = (await res.json()) as {
      result: { structuredContent: { error: { code: string } } };
    };
    expect(body.result.structuredContent.error.code).toBe("not_available");
  });

  it("manglende verktøy-scope gir HTTP 200 med insufficient_scope", async () => {
    authResult = {
      ok: true,
      userId: "user-1",
      integrationId: "int-1",
      grantId: "grant-1",
      scopes: ["karriere.status.read"],
    };
    const res = await post(
      rpc("tools/call", { name: "karrierenmin_run", arguments: { workflow_kind: "job_import" } }),
    );
    const body = (await res.json()) as {
      result: {
        isError: boolean;
        content: { type: string; text: string }[];
        structuredContent?: unknown;
      };
    };
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("insufficient_scope");
    // Tilgangsfeil har ingen structuredContent: outputSchema beskriver kun
    // det vellykkede resultatet.
    expect(body.result).not.toHaveProperty("structuredContent");
  });

  it("frakoblet/manglende integrasjon gir integration_inactive", async () => {
    integrationRow = null;
    const res = await post(rpc("tools/call", { name: "karrierenmin_status", arguments: {} }));
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("integration_inactive");
    expect(body.result).not.toHaveProperty("structuredContent");
  });

  it("integrasjon som eies av en annen bruker avvises", async () => {
    integrationRow = { ...(integrationRow as Record<string, unknown>), user_id: "annen" };
    const res = await post(rpc("tools/call", { name: "karrierenmin_status", arguments: {} }));
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(body.result.content[0]!.text).toContain("integration_inactive");
    expect(body.result).not.toHaveProperty("structuredContent");
  });

  it("ukjent verktøynavn gir -32602", async () => {
    const res = await post(rpc("tools/call", { name: "karrierenmin_claim", arguments: {} }));
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32602);
  });
});

describe("leverandørnøytralitet", () => {
  it("alle fem leverandørene får identisk verktøyliste og identisk statusform", async () => {
    const shapes = new Set<string>();
    for (const provider of AI_PROVIDERS) {
      integrationRow = {
        id: "int-1",
        user_id: "user-1",
        provider,
        status: "active",
        effective_mode: "guided",
        capabilities: {},
        last_verified_at: null,
      };
      const list = (await (await post(rpc("tools/list"))).json()) as {
        result: { tools: unknown[] };
      };
      const status = (await (
        await post(rpc("tools/call", { name: "karrierenmin_status", arguments: {} }))
      ).json()) as { result: { structuredContent: { integration: Record<string, unknown> } } };
      expect(status.result.structuredContent.integration["provider"]).toBe(provider);
      shapes.add(
        JSON.stringify([
          list.result.tools,
          Object.keys(status.result.structuredContent.integration).sort(),
        ]),
      );
    }
    expect(shapes.size).toBe(1);
  });
});

describe("delt domenelag og ingen sesjonstilstand", () => {
  const ROOT = process.cwd();
  const mcpRoute = readFileSync(join(ROOT, "src", "routes", "api", "public", "mcp.ts"), "utf8");
  const restStatus = readFileSync(
    join(ROOT, "src", "routes", "api", "public", "ai-integrations", "v1", "status.ts"),
    "utf8",
  );
  const restRun = readFileSync(
    join(ROOT, "src", "routes", "api", "public", "ai-integrations", "v1", "run.ts"),
    "utf8",
  );

  it("REST-rutene bruker det delte domenelaget", () => {
    expect(restStatus).toContain("agent-domain.server");
    expect(restRun).toContain("agent-domain.server");
    // Ingen egen databasespørring igjen i kompatibilitetslaget.
    expect(restStatus).not.toContain("automation_preferences");
    expect(restRun).not.toContain("automation_preferences");
  });

  it("MCP-ruten har ingen sesjonshåndtering", () => {
    expect(mcpRoute.toLowerCase()).not.toContain("mcp-session-id");
    expect(mcpRoute.toLowerCase()).not.toContain("sessionid");
  });

  it("MCP-ruten logger kun trygge avvisningsfelt, aldri body eller headere", () => {
    // Kun console.error, og kun via den ene byggeren av avvisningsloggen.
    expect(mcpRoute).not.toMatch(/console\.(log|info|warn)/);
    expect(mcpRoute).toContain("mcp_request_rejected");
    expect(mcpRoute).not.toMatch(/console\.error\((?!JSON\.stringify\(buildMcpRejectionLog)/);
  });
});

describe("OPTIONS og ytre feilgrense", () => {
  async function options(headers: Record<string, string> = {}) {
    const handlers = await route();
    return handlers["OPTIONS"]!({ request: new Request(URL_MCP, { method: "OPTIONS", headers }) });
  }

  it("OPTIONS uten Origin gir 204 uten CORS-headere", async () => {
    const res = await options();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS med kjent Origin gir 204 med snevre CORS-headere", async () => {
    const res = await options({ origin: ORIGIN });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("OPTIONS med fremmed, tom eller null Origin gir 403", async () => {
    for (const origin of ["https://evil.example", "null", "", "   "]) {
      const res = await options({ origin });
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("POST med Origin: null, tom eller whitespace gir 403", async () => {
    for (const origin of ["null", "", "   "]) {
      const res = await post(rpc("ping"), { headers: { origin } });
      expect(res.status).toBe(403);
    }
  });

  it("uventet unntak gir generisk intern feil uten lekkasje", async () => {
    authThrows = true;
    const res = await post(rpc("ping"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("-32603");
    expect(text).not.toContain("hemmelig");
    expect(text).not.toContain("abc123");
    expect(text.toLowerCase()).not.toContain("stack");
  });
});
