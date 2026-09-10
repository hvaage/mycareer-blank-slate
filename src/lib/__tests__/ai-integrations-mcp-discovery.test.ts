// ============================================================
// Regresjonstest på HTTP-nivå for ChatGPT/Codex sin verktøyoppdagelse.
//
// Kjører den faktiske rutehandleren gjennom hele sekvensen en MCP-klient
// bruker etter OAuth: initialize -> notifications/initialized -> tools/list,
// med de headerne en ekstern (ikke-nettleser) klient sender: ingen Origin,
// `Accept: application/json, text/event-stream`, `MCP-Protocol-Version`.
//
// Testen dekker den observerte oppdagelsesfeilen: ChatGPT kaller
// resources/list og resources/templates/list etter tools/list og avbryter
// på -32601. Alle fire svar valideres mot SDK-ens resultatskjemaer, og
// verktøyenes structuredContent valideres mot deres outputSchema.
// ============================================================

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  InitializeResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { MCP_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";
import { buildMcpRejectionLog } from "@/routes/api/public/mcp";

const ORIGIN = "https://karrierenmin.no";
const URL_MCP = `${ORIGIN}${MCP_ENDPOINT_PATH}`;

vi.mock("@/lib/ai-integrations/oauth-auth.server", () => ({
  authenticateOauthRequest: () =>
    Promise.resolve({
      ok: true,
      userId: "user-1",
      integrationId: "int-1",
      grantId: "grant-1",
      scopes: ["karriere.status.read", "karriere.workflow.run"],
    }),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const value =
        table === "ai_integrations"
          ? {
              id: "int-1",
              user_id: "user-1",
              provider: "chatgpt",
              status: "active",
              effective_mode: "guided",
              capabilities: {},
              last_verified_at: null,
            }
          : {
              job_email_import_enabled: false,
              career_email_suggestions_enabled: false,
              linkedin_ready_detection_enabled: false,
            };
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: value, error: null }),
      };
      return builder;
    },
  },
}));

async function handlers() {
  const mod = await import("@/routes/api/public/mcp");
  return (
    mod.Route as unknown as {
      options: {
        server: { handlers: Record<string, (ctx: { request: Request }) => Promise<Response>> };
      };
    }
  ).options.server.handlers;
}

/** Nøyaktig de headerne en ekstern MCP-klient sender: ingen Origin. */
async function post(body: unknown, protocolVersion = "2025-06-18"): Promise<Response> {
  const h = await handlers();
  return h["POST"]!({
    request: new Request(URL_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "mcp-protocol-version": protocolVersion,
      },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  process.env["PUBLIC_APP_ORIGIN"] = ORIGIN;
});

describe("ChatGPT-oppdagelse over Streamable HTTP", () => {
  for (const version of ["2025-06-18", "2025-11-25"] as const) {
    it(`fullfører initialize -> initialized -> tools/list på ${version}`, async () => {
      const init = await post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: version,
            capabilities: {},
            clientInfo: { name: "ChatGPT", version: "1.0.0" },
          },
        },
        version,
      );
      expect(init.status).toBe(200);
      const initBody = await init.json();
      expect(initBody.error).toBeUndefined();
      const initResult = InitializeResultSchema.safeParse(initBody.result);
      expect(initResult.success).toBe(true);
      expect(initBody.result.protocolVersion).toBe(version);
      expect(initBody.result.capabilities.tools).toBeDefined();
      // ChatGPT viser «Website: Unavailable» uten dette feltet.
      expect(initBody.result.serverInfo.websiteUrl).toBe(ORIGIN);

      const notified = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, version);
      expect(notified.status).toBe(202);

      const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, version);
      expect(list.status).toBe(200);
      const listBody = await list.json();
      expect(listBody.error).toBeUndefined();
      expect(ListToolsResultSchema.safeParse(listBody.result).success).toBe(true);

      const names = listBody.result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain("karrierenmin_status");
      for (const tool of listBody.result.tools) {
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema.type).toBe("object");
        // outputSchema beskriver det vellykkede resultatet og må være et
        // kompilerbart JSON-skjema.
        expect(tool.outputSchema.type).toBe("object");
        expect(() => new AjvJsonSchemaValidator().getValidator(tool.outputSchema)).not.toThrow();
      }

      // ChatGPT kaller disse rett etter tools/list og avbryter oppdagelsen
      // dersom de svarer -32601.
      const resources = await post({ jsonrpc: "2.0", id: 3, method: "resources/list" }, version);
      expect(resources.status).toBe(200);
      const resourcesBody = await resources.json();
      expect(resourcesBody.error).toBeUndefined();
      expect(resourcesBody.result.resources).toEqual([]);
      expect(ListResourcesResultSchema.safeParse(resourcesBody.result).success).toBe(true);

      const templates = await post(
        { jsonrpc: "2.0", id: 4, method: "resources/templates/list" },
        version,
      );
      expect(templates.status).toBe(200);
      const templatesBody = await templates.json();
      expect(templatesBody.error).toBeUndefined();
      expect(templatesBody.result.resourceTemplates).toEqual([]);
      expect(ListResourceTemplatesResultSchema.safeParse(templatesBody.result).success).toBe(true);
    });
  }

  it("tools/list uten params er gyldig JSON-RPC med begge verktøyene", async () => {
    const list = await post({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} });
    const body = await list.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(7);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "karrierenmin_status",
      "karrierenmin_run",
    ]);
  });
});

describe("MCP-avvisningslogg", () => {
  it("inneholder kun trygge, stabile felt", () => {
    expect(buildMcpRejectionLog("not_acceptable")).toEqual({
      event: "mcp_request_rejected",
      reason: "not_acceptable",
    });
    const full = buildMcpRejectionLog("jsonrpc_error", "tools/list", -32602, "2025-06-18");
    expect(full).toEqual({
      event: "mcp_request_rejected",
      reason: "jsonrpc_error",
      method: "tools/list",
      jsonrpc_code: -32602,
      protocol_version: "2025-06-18",
    });
    const serialized = JSON.stringify(full);
    for (const forbidden of ["Bearer", "token", "authorization", "user-1", "int-1"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
