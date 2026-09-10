// ============================================================
// Regresjonstest: /mcp er et ekte alias for den kanoniske transporten.
//
// ChatGPT kaller POST https://karrierenmin.no/mcp. Aliaset skal kjøre
// nøyaktig samme handler som /api/public/mcp — samme OAuth-verifikasjon,
// samme herding, samme feilformat — og aldri svare med en 30x-redirect
// (en redirect ville mistet både body og Authorization på en POST).
// ============================================================

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_ALIAS_ENDPOINT_PATH,
  MCP_ENDPOINT_PATH,
} from "@/lib/ai-integrations/mcp-contract";

const ORIGIN = "https://karrierenmin.no";

let authenticated = true;

vi.mock("@/lib/ai-integrations/oauth-auth.server", () => ({
  authenticateOauthRequest: () =>
    Promise.resolve(
      authenticated
        ? {
            ok: true,
            userId: "user-1",
            integrationId: "int-1",
            grantId: "grant-1",
            scopes: ["karriere.status.read", "karriere.workflow.run"],
          }
        : { ok: false, status: 401, error: "invalid_token" },
    ),
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

type Handlers = Record<string, (ctx: { request: Request }) => Promise<Response>>;

async function handlers(path: "alias" | "canonical"): Promise<Handlers> {
  const mod =
    path === "alias"
      ? await import("@/routes/mcp/index")
      : await import("@/routes/api/public/mcp");
  return (mod.Route as unknown as { options: { server: { handlers: Handlers } } }).options.server
    .handlers;
}

function request(path: string, body: unknown, withToken = true): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(withToken ? { authorization: "Bearer test-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env["PUBLIC_APP_ORIGIN"] = ORIGIN;
  authenticated = true;
});

describe("MCP-alias /mcp", () => {
  for (const [label, key] of [
    ["alias", "alias"],
    ["kanonisk", "canonical"],
  ] as const) {
    const path = key === "alias" ? MCP_ALIAS_ENDPOINT_PATH : MCP_ENDPOINT_PATH;

    it(`${label} sti fullfører initialize -> initialized -> tools/list`, async () => {
      const h = await handlers(key);
      const init = await h["POST"]!({
        request: request(path, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "ChatGPT", version: "1.0.0" },
          },
        }),
      });
      expect(init.status).toBe(200);
      expect((await init.json()).result.serverInfo.websiteUrl).toBe(ORIGIN);

      const notified = await h["POST"]!({
        request: request(path, { jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      expect(notified.status).toBe(202);

      const list = await h["POST"]!({
        request: request(path, { jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
      expect(list.status).toBe(200);
      const body = await list.json();
      expect(ListToolsResultSchema.safeParse(body.result).success).toBe(true);
      expect(body.result.tools.map((t: { name: string }) => t.name)).toContain(
        "karrierenmin_status",
      );
    });

    it(`${label} sti svarer 405 på GET og 204 på OPTIONS, aldri 30x`, async () => {
      const h = await handlers(key);
      const get = await h["GET"]!({ request: new Request(`${ORIGIN}${path}`) });
      expect(get.status).toBe(405);
      expect(get.headers.get("allow")).toBe("POST, OPTIONS");

      const options = await h["OPTIONS"]!({
        request: new Request(`${ORIGIN}${path}`, { method: "OPTIONS" }),
      });
      expect(options.status).toBe(204);
    });
  }

  it("aliaset peker på sin egen protected-resource-metadata i 401-utfordringen", async () => {
    authenticated = false;
    const h = await handlers("alias");
    const res = await h["POST"]!({
      request: request(MCP_ALIAS_ENDPOINT_PATH, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource${MCP_ALIAS_ENDPOINT_PATH}"`,
    );
  });

  it("kanonisk sti beholder sin egen metadata-peker i 401-utfordringen", async () => {
    authenticated = false;
    const h = await handlers("canonical");
    const res = await h["POST"]!({
      request: request(MCP_ENDPOINT_PATH, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}"`,
    );
  });
});

describe("Protected-resource-metadata for aliaset", () => {
  it("oppgir aliasets eksakte URL, samme issuer og samme scopes", async () => {
    const { protectedResourceMetadataResponse } = await import(
      "@/lib/ai-integrations/oauth-resource-metadata.server"
    );
    const res = protectedResourceMetadataResponse(MCP_ALIAS_ENDPOINT_PATH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(body.resource).toBe(`${ORIGIN}${MCP_ALIAS_ENDPOINT_PATH}`);
    expect(body.authorization_servers).toEqual([ORIGIN]);
    expect(body.scopes_supported).toContain("karriere.status.read");
  });
});

describe("Resource-binding for begge URL-ene", () => {
  it("godtar nøyaktig de to identifikatorene og ingenting annet", async () => {
    const { mcpResourceIdentifiers, resolveMcpResource } = await import(
      "@/lib/ai-integrations/oauth-config.server"
    );
    expect(mcpResourceIdentifiers(ORIGIN)).toEqual([
      `${ORIGIN}${MCP_ENDPOINT_PATH}`,
      `${ORIGIN}${MCP_ALIAS_ENDPOINT_PATH}`,
    ]);
    expect(resolveMcpResource(ORIGIN, `${ORIGIN}/mcp`)).toBe(`${ORIGIN}/mcp`);
    expect(resolveMcpResource(ORIGIN, `${ORIGIN}/api/public/mcp`)).toBe(
      `${ORIGIN}/api/public/mcp`,
    );
    // Ingen prefiksmatching, ingen normalisering, ingen fremmed vert.
    expect(resolveMcpResource(ORIGIN, `${ORIGIN}/mcp/`)).toBeNull();
    expect(resolveMcpResource(ORIGIN, `${ORIGIN}/mcp?x=1`)).toBeNull();
    expect(resolveMcpResource(ORIGIN, "https://evil.example/mcp")).toBeNull();
    expect(resolveMcpResource(ORIGIN, ` ${ORIGIN}/mcp `)).toBeNull();
    expect(resolveMcpResource(ORIGIN, undefined)).toBeNull();
  });

  it("tokenverifisering krever fortsatt eksakt aud som er lik resource", async () => {
    const { verifyOauthAccessToken } = await import(
      "@/lib/ai-integrations/oauth-access-token.server"
    );
    const res = await verifyOauthAccessToken("ikke-et-token", {
      resource: [`${ORIGIN}/api/public/mcp`, `${ORIGIN}/mcp`],
      issuer: ORIGIN,
    });
    expect(res.ok).toBe(false);
  });
});
