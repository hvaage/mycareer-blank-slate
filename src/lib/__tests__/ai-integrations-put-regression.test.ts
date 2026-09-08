import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  EMAIL_PROVIDER_CHOICE_IS_PERSISTED,
  nextIntegrationStatus,
  parseSaveIntegrationInput,
} from "@/lib/ai-integrations/contract";

// ------------------------------------------------------------------
// Regresjonstester for avvikene i fase 1.
// ------------------------------------------------------------------

describe("provider er valgfritt («jeg vil velge senere»)", () => {
  it("godtar manglende provider og lagrer likevel datavalgene", () => {
    const result = parseSaveIntegrationInput({
      automation: { job_email_import_enabled: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBeNull();
    expect(result.value.automation.job_email_import_enabled).toBe(false);
  });

  it("godtar provider = null", () => {
    const result = parseSaveIntegrationInput({ provider: null, plan_tier: "free" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBeNull();
  });

  it("avviser fortsatt ugyldig provider", () => {
    expect(parseSaveIntegrationInput({ provider: "llama" }).ok).toBe(false);
    expect(parseSaveIntegrationInput({ provider: 42 }).ok).toBe(false);
  });
});

describe("status bevares ved oppdatering", () => {
  it("beholder active og degraded", () => {
    expect(nextIntegrationStatus("active")).toBe("active");
    expect(nextIntegrationStatus("degraded")).toBe("degraded");
  });

  it("gir connecting for ny integrasjon", () => {
    expect(nextIntegrationStatus(null)).toBe("connecting");
    expect(nextIntegrationStatus(undefined)).toBe("connecting");
  });

  it("gir connecting når en frakoblet integrasjon kobles til på nytt", () => {
    expect(nextIntegrationStatus("disconnected")).toBe("connecting");
  });
});

describe("e-postleverandørvalget", () => {
  it("er eksplisitt merket som ikke-persistent i fase 1", () => {
    // Skjemaet har ingen egnet plass: email_connections krever reell
    // tilkoblet konto og dekker bare google/microsoft.
    expect(EMAIL_PROVIDER_CHOICE_IS_PERSISTED).toBe(false);
  });

  it("sendes ikke videre av valideringen selv om klienten skulle sende det", () => {
    const result = parseSaveIntegrationInput({ provider: "claude", email_provider: "apple" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["automation", "plan_tier", "provider"]);
  });
});

// ------------------------------------------------------------------
// Rutetester med etterlignet databaseklient.
// ------------------------------------------------------------------

type Result = { data?: unknown; error?: unknown };
const results = new Map<string, Result>();
const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

function builder(table: string) {
  const state = { op: "select" as string, payload: undefined as unknown };
  const chain: Record<string, unknown> = {};
  const api = new Proxy(chain, {
    get(_t, prop: string) {
      if (prop === "then") {
        const result = results.get(`${table}:${state.op}`) ?? { data: null, error: null };
        calls.push({ table, op: state.op, payload: state.payload });
        return (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve);
      }
      return (...args: unknown[]) => {
        if (["upsert", "insert", "update"].includes(prop)) {
          state.op = prop;
          state.payload = args[0];
        }
        if (["single", "maybeSingle"].includes(prop)) {
          const result = results.get(`${table}:${state.op}`) ?? { data: null, error: null };
          calls.push({ table, op: state.op, payload: state.payload });
          return Promise.resolve(result);
        }
        return api;
      };
    },
  });
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

vi.mock("@/lib/api-auth.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-auth.server")>(
    "@/lib/api-auth.server",
  );
  return {
    ...actual,
    authenticateApiRequest: async () => ({
      userId: "11111111-1111-1111-1111-111111111111",
      userClient: { from: () => builder("email_job_sources") },
    }),
  };
});

async function putHandler() {
  const mod = await import("@/routes/api/ai-integrations/index");
  const handlers = (
    mod.Route as unknown as {
      options: { server: { handlers: Record<string, (c: { request: Request }) => Promise<Response>> } };
    }
  ).options.server.handlers;
  return handlers["PUT"]!;
}

async function sessionHandler() {
  const mod = await import("@/routes/api/ai-integrations/setup-session");
  const handlers = (
    mod.Route as unknown as {
      options: { server: { handlers: Record<string, (c: { request: Request }) => Promise<Response>> } };
    }
  ).options.server.handlers;
  return handlers["POST"]!;
}

function put(body: unknown) {
  return new Request("http://localhost/api/ai-integrations", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/ai-integrations", () => {
  beforeEach(() => {
    results.clear();
    calls.length = 0;
  });

  it("lagrer preferanser uten å opprette integrasjon når provider mangler", async () => {
    const handler = await putHandler();
    const res = await handler({ request: put({ automation: { job_email_import_enabled: true } }) });
    const json = (await res.json()) as { ok: boolean; integration: unknown };
    expect(json.ok).toBe(true);
    expect(json.integration).toBeNull();
    expect(calls.some((c) => c.table === "automation_preferences" && c.op === "upsert")).toBe(true);
    expect(calls.some((c) => c.table === "ai_integrations")).toBe(false);
  });

  it("beholder eksisterende active-status ved endret abonnement", async () => {
    results.set("ai_integrations:select", {
      data: { id: "int-1", status: "active", capabilities: {} },
      error: null,
    });
    results.set("ai_integrations:update", { data: { id: "int-1", status: "active" }, error: null });
    const handler = await putHandler();
    await handler({ request: put({ provider: "claude", plan_tier: "paid" }) });
    const update = calls.find((c) => c.table === "ai_integrations" && c.op === "update");
    expect((update?.payload as { status: string }).status).toBe("active");
    expect(update?.payload).not.toHaveProperty("capabilities");
    expect(update?.payload).not.toHaveProperty("last_verified_at");
  });

  it("setter connecting når en frakoblet integrasjon kobles til på nytt", async () => {
    results.set("ai_integrations:select", {
      data: { id: "int-1", status: "disconnected", capabilities: {} },
      error: null,
    });
    results.set("ai_integrations:update", { data: { id: "int-1" }, error: null });
    const handler = await putHandler();
    await handler({ request: put({ provider: "gemini" }) });
    const update = calls.find((c) => c.table === "ai_integrations" && c.op === "update");
    expect((update?.payload as { status: string }).status).toBe("connecting");
  });

  it("rapporterer delvis lagring i stedet for totalfeil", async () => {
    results.set("ai_integrations:select", { data: null, error: null });
    results.set("ai_integrations:insert", { data: null, error: { message: "boom" } });
    const handler = await putHandler();
    const res = await handler({ request: put({ provider: "openai" }) });
    expect(res.status).toBe(207);
    const json = (await res.json()) as { error: { code: string }; saved: Record<string, boolean> };
    expect(json.error.code).toBe("partial_failure");
    expect(json.saved).toEqual({ automation: true, integration: false });
  });
});

describe("POST /api/ai-integrations/setup-session", () => {
  beforeEach(() => {
    results.clear();
    calls.length = 0;
  });

  it("lager ingen ny kode når invalidering av gamle koder feiler", async () => {
    results.set("ai_integrations:select", { data: { id: "int-1", provider: "grok" }, error: null });
    results.set("ai_integration_setup_sessions:update", { error: { message: "boom" } });
    const handler = await sessionHandler();
    const res = await handler({
      request: new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ provider: "grok" }),
      }),
    });
    expect(res.status).toBe(500);
    expect(
      calls.some((c) => c.table === "ai_integration_setup_sessions" && c.op === "insert"),
    ).toBe(false);
  });
});
