// ============================================================
// Tester for OAuth-herdingen: CIMD-policy, herdet DCR, tokenkontrakt,
// statusflyt i databasefunksjonen og at callback aldri logger credentials.
//
// MERK: filtestene under er kildekontroller, ikke ende-til-ende.
// De er merket deretter og erstatter ikke en faktisk klientflyt.
// ============================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CIMD_HOST_POLICIES,
  DCR_EXACT_REDIRECTS,
  checkCimdUrl,
  isAllowlistedDcrRedirect,
  isClaudeLoopbackRedirect,
  isCleanHttpsUri,
  parseExtraRedirectAllowlist,
  validateCimdMetadata,
  isClaudeLoopbackTemplate,
  redirectUriAllowedForClient,
  allowsPortAgnosticLoopback,
  negotiateTokenEndpointAuthMethod,
} from "@/lib/ai-integrations/oauth-client-policy";
import { DCR_MAX_BODY_BYTES, utf8ByteLength } from "@/routes/api/public/oauth/register";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_ORDER,
} from "@/lib/ai-integrations/contract";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// ---------------- CIMD ----------------

describe("CIMD-URL-policy", () => {
  it("godtar de dokumenterte adressene", () => {
    expect(checkCimdUrl("https://chatgpt.com/oauth/client.json").ok).toBe(true);
    expect(checkCimdUrl("https://chatgpt.com/oauth/abc123/client.json").ok).toBe(true);
    expect(checkCimdUrl("https://claude.ai/oauth/claude-code-client-metadata").ok).toBe(true);
  });

  it("avviser ukjent vert, suffikstriks og underdomene", () => {
    for (const url of [
      "https://evil.com/oauth/client.json",
      "https://chatgpt.com.evil.com/oauth/client.json",
      "https://evil-chatgpt.com/oauth/client.json",
      "https://sub.chatgpt.com/oauth/client.json",
    ]) {
      expect(checkCimdUrl(url).ok).toBe(false);
    }
  });

  it("avviser ukjent bane, query, fragment, userinfo, port og http", () => {
    for (const url of [
      "https://chatgpt.com/oauth/other.json",
      "https://chatgpt.com/oauth/client.json?x=1",
      "https://chatgpt.com/oauth/client.json#a",
      "https://user:pw@chatgpt.com/oauth/client.json",
      "https://chatgpt.com:8443/oauth/client.json",
      "http://chatgpt.com/oauth/client.json",
    ]) {
      expect(checkCimdUrl(url).ok).toBe(false);
    }
  });
});

describe("CIMD-metadata", () => {
  const claude = CIMD_HOST_POLICIES.find((p) => p.host === "claude.ai")!;
  const chatgpt = CIMD_HOST_POLICIES.find((p) => p.label === "ChatGPT")!;
  const claudeUrl = "https://claude.ai/oauth/claude-code-client-metadata";
  const chatgptUrl = "https://chatgpt.com/oauth/client.json";

  it("godtar Claude Code-loopback kun for verifisert Claude-metadata", () => {
    const ok = validateCimdMetadata(
      { redirect_uris: ["http://127.0.0.1:54321/callback", "http://localhost:8912/callback"] },
      { url: claudeUrl, policy: claude },
    );
    expect(ok.ok).toBe(true);

    const rejected = validateCimdMetadata(
      { redirect_uris: ["http://127.0.0.1:54321/callback"] },
      { url: chatgptUrl, policy: chatgpt },
    );
    expect(rejected.ok).toBe(false);
  });

  it("avviser loopback med feil bane eller privilegert port", () => {
    for (const uri of [
      "http://127.0.0.1:54321/cb",
      "http://127.0.0.1:80/callback",
      "http://192.168.1.5:54321/callback",
      "https://127.0.0.1:54321/callback",
    ]) {
      expect(isClaudeLoopbackRedirect(uri)).toBe(false);
    }
  });

  it("avviser metadata som utvider serverens tillatelser", () => {
    const base = { redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] };
    const ctx = { url: chatgptUrl, policy: chatgpt };
    expect(validateCimdMetadata({ ...base, client_id: "annet" }, ctx).ok).toBe(false);
    expect(
      validateCimdMetadata({ ...base, token_endpoint_auth_method: "client_secret_post" }, ctx).ok,
    ).toBe(false);
    expect(validateCimdMetadata({ ...base, grant_types: ["password"] }, ctx).ok).toBe(false);
    expect(validateCimdMetadata({ ...base, response_types: ["token"] }, ctx).ok).toBe(false);
    expect(validateCimdMetadata({ ...base, scope: "karriere.alt" }, ctx).ok).toBe(false);
  });

  it("krever redirect på klientens egen vert", () => {
    const ctx = { url: chatgptUrl, policy: chatgpt };
    expect(validateCimdMetadata({ redirect_uris: ["https://evil.com/cb"] }, ctx).ok).toBe(false);
  });
});

// ---------------- token endpoint auth method-forhandling ----------------

describe("token_endpoint_auth_method-forhandling", () => {
  const chatgpt = CIMD_HOST_POLICIES.find((p) => p.label === "ChatGPT")!;
  const ctx = { url: "https://chatgpt.com/oauth/client.json", policy: chatgpt };
  const base = { redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] };

  it("godtar ChatGPTs faktiske produksjonsdokument og velger none", () => {
    const result = validateCimdMetadata(
      {
        client_id: "https://chatgpt.com/oauth/client.json",
        client_uri: "https://chatgpt.com/",
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "ChatGPT",
        logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
        token_endpoint_auth_signing_alg: "RS256",
        jwks_uri: "https://chatgpt.com/oauth/jwks.json",
      } as never,
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokenEndpointAuthMethod).toBe("none");
      expect(result.redirectUris).toEqual([
        "https://chatgpt.com/connector_platform_oauth_redirect",
      ]);
    }
  });

  it("godtar overgangspayloaden og velger none", () => {
    const result = validateCimdMetadata(
      {
        ...base,
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_method: "private_key_jwt",
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokenEndpointAuthMethod).toBe("none");
    }
  });

  it("avviser plural uten none i skjæringspunktet", () => {
    expect(
      validateCimdMetadata(
        { ...base, token_endpoint_auth_methods_supported: ["private_key_jwt"] },
        ctx,
      ).ok,
    ).toBe(false);
  });

  it("avviser ugyldig eller tom plural-array", () => {
    for (const plural of [
      [],
      "none",
      [123],
      [""],
      ["none", "none"],
      ["n".repeat(65)],
      Array.from({ length: 11 }, (_, i) => `m${i}`),
    ]) {
      expect(
        validateCimdMetadata(
          { ...base, token_endpoint_auth_methods_supported: plural as unknown },
          ctx,
        ).ok,
      ).toBe(false);
    }
  });

  it("beholder legacy-oppførsel uten pluralfelt", () => {
    expect(validateCimdMetadata({ ...base, token_endpoint_auth_method: "none" }, ctx).ok).toBe(
      true,
    );
    expect(
      validateCimdMetadata({ ...base, token_endpoint_auth_method: "private_key_jwt" }, ctx).ok,
    ).toBe(false);
    expect(validateCimdMetadata(base, ctx).ok).toBe(true);
  });

  it("forhandler direkte mot serverens metoder uten normalisering", () => {
    expect(negotiateTokenEndpointAuthMethod({})).toEqual({ ok: true, method: "none" });
    expect(
      negotiateTokenEndpointAuthMethod({
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_method: "private_key_jwt",
      }),
    ).toEqual({ ok: true, method: "none" });
    // Eksakte protokollidentifikatorer: whitespace-varianter er ikke "none".
    expect(
      negotiateTokenEndpointAuthMethod({
        token_endpoint_auth_methods_supported: [" none "],
        token_endpoint_auth_method: "private_key_jwt",
      }).ok,
    ).toBe(false);
    expect(
      negotiateTokenEndpointAuthMethod({
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }).ok,
    ).toBe(false);
  });
});

// ---------------- herdet DCR ----------------

describe("DCR-allowliste", () => {
  it("godtar de dokumenterte callbackene", () => {
    for (const uri of DCR_EXACT_REDIRECTS) expect(isAllowlistedDcrRedirect(uri)).toBe(true);
    expect(isAllowlistedDcrRedirect("https://chatgpt.com/connector/oauth/abc_123")).toBe(true);
  });

  it("avviser ukjent redirect, suffikstriks, userinfo, fragment og privat IP", () => {
    for (const uri of [
      "https://evil.com/cb",
      "https://chatgpt.com.evil.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector_platform_oauth_redirect/extra",
      "https://user:pw@chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector_platform_oauth_redirect#a",
      "https://192.168.1.10/cb",
      "https://10.0.0.4/cb",
      "https://claude.ai/*",
    ]) {
      expect(isAllowlistedDcrRedirect(uri)).toBe(false);
    }
  });

  it("åpner aldri generisk loopback for DCR", () => {
    for (const uri of [
      "http://localhost:8080/callback",
      "http://127.0.0.1:54321/callback",
      "https://localhost/callback",
    ]) {
      expect(isAllowlistedDcrRedirect(uri)).toBe(false);
    }
  });

  it("blokkerer Copilot og Grok til drift konfigurerer en faktisk callback", () => {
    const copilot = "https://copilotstudio.microsoft.com/oauth/callback";
    const grok = "https://grok.x.ai/oauth/callback";
    expect(isAllowlistedDcrRedirect(copilot)).toBe(false);
    expect(isAllowlistedDcrRedirect(grok)).toBe(false);

    const extra = parseExtraRedirectAllowlist(`${copilot} ${grok}`);
    expect(isAllowlistedDcrRedirect(copilot, extra)).toBe(true);
    expect(isAllowlistedDcrRedirect("https://copilotstudio.microsoft.com/annet", extra)).toBe(
      false,
    );
  });

  it("driftsallowlisten tar bare rene https-adresser", () => {
    expect(parseExtraRedirectAllowlist("http://a.no/cb, https://b.no/cb, ikke-en-url")).toEqual([
      "https://b.no/cb",
    ]);
  });

  it("fellesreglene avviser port, wildcard og http", () => {
    expect(isCleanHttpsUri("https://a.no:8443/cb")).toBe(false);
    expect(isCleanHttpsUri("https://a.no/*")).toBe(false);
    expect(isCleanHttpsUri("http://a.no/cb")).toBe(false);
    expect(isCleanHttpsUri("https://a.no/cb")).toBe(true);
  });
});

// ---------------- Microsoft Copilot som femte likestilte ----------------

describe("Copilot er likestilt", () => {
  it("finnes i kontrakten uten forhåndsvalg", () => {
    expect(AI_PROVIDERS).toContain("copilot");
    expect(AI_PROVIDER_ORDER).toHaveLength(5);
    expect(AI_PROVIDER_ORDER).toContain("copilot");
    expect(AI_PROVIDER_LABELS.copilot).toBe("Microsoft Copilot");
  });

  it("har en egen pakke som ikke påstår verifisert installasjon", () => {
    const readme = read("integrations/karrierenmin-agents/copilot/README.md");
    expect(readme.replace(/\s+/g, " ")).toContain("ikke verifisert ende-til-ende");
    expect(readme).toContain("OAUTH_EXTRA_REDIRECT_URIS");
  });
});

// ---------------- kildekontroller (ikke ende-til-ende) ----------------

describe("kildekontroll: callback lekker ingen credentials", () => {
  const src = read("src/routes/auth.callback.tsx");

  it("logger ikke adresse, kode, state eller token", () => {
    expect(src).not.toContain("console.info");
    expect(src).not.toMatch(/console\.(log|debug)/);
    for (const forbidden of [
      'console.error("auth callback input',
      "window.location.href.split",
      "hashKeys",
    ]) {
      expect(src).not.toContain(forbidden);
    }
    // Ingen logglinje nevner kode, state eller token.
    const logLines = src.split("\n").filter((l) => l.includes("console."));
    for (const line of logLines) {
      expect(line).not.toMatch(/code|state|token|href|search/i);
    }
  });
});

describe("kildekontroll: tokenruten", () => {
  const src = read("src/routes/api/public/oauth/token.ts");

  it("gjør preflight på signeringshemmeligheten før databasen berøres", () => {
    const preflight = src.indexOf("readOauthSecret()");
    const rpc = src.indexOf("db.rpc(");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(rpc);
  });

  it("bruker v2-funksjonene og sender resource inn i innløsingen", () => {
    expect(src).toContain("oauth_redeem_authorization_code_v2");
    expect(src).toContain("oauth_rotate_refresh_token_v2");
    expect(src).toContain("p_resource: urls.resource");
  });

  it("tar provider fra databasen, ikke fra klienten", () => {
    expect(src).toContain("provider: row.provider as AiProvider");
  });

  it("returnerer ingen capability-felter i tokensvaret", () => {
    const payload = src.slice(src.indexOf("access_token: issued.token"));
    expect(payload.toLowerCase()).not.toContain("capabilit");
    expect(payload.toLowerCase()).not.toContain("verified");
  });
});

describe("kildekontroll: discovery annonserer CIMD", () => {
  it("har client_id_metadata_document_supported og auth-metode none", () => {
    const src = read("src/routes/[.]well-known/oauth-authorization-server.ts");
    expect(src).toContain("client_id_metadata_document_supported: true");
    expect(src).toContain('token_endpoint_auth_methods_supported: ["none"]');
  });
});

describe("kildekontroll: CIMD-henting er rammet inn", () => {
  const src = read("src/lib/ai-integrations/oauth-cimd.server.ts");

  it("følger ikke omdirigeringer, har timeout og størrelsesgrense", () => {
    expect(src).toContain('redirect: "error"');
    expect(src).toContain("CIMD_TIMEOUT_MS");
    expect(src).toContain("CIMD_MAX_BYTES");
    expect(src).toContain("application/json");
  });

  it("revaliderer utløpt cache", () => {
    expect(src).toContain("metadata_expires_at");
    expect(src).toContain("oauth_upsert_cimd_client");
  });
});

// ---------- Claude Code: portløs metadata-mal, portert authorize-redirect ----------

describe("Claude Code loopback", () => {
  const claudePolicy = CIMD_HOST_POLICIES.find((p) => p.host === "claude.ai")!;
  const claudeUrl = "https://claude.ai/oauth/claude-code-client-metadata";
  const officialTemplates = ["http://localhost/callback", "http://127.0.0.1/callback"];

  const claudeClient = {
    registration_method: "cimd",
    client_id: claudeUrl,
    metadata_url: claudeUrl,
    redirect_uris: officialTemplates,
  };

  it("godtar det offisielle portløse metadataformatet", () => {
    const result = validateCimdMetadata(
      { redirect_uris: officialTemplates },
      { url: claudeUrl, policy: claudePolicy },
    );
    expect(result.ok).toBe(true);
    for (const t of officialTemplates) expect(isClaudeLoopbackTemplate(t)).toBe(true);
    expect(isClaudeLoopbackTemplate("http://127.0.0.1:54321/callback")).toBe(false);
  });

  it("matcher en tilfeldig ephemeral port i authorize-forespørselen", () => {
    for (const port of [1024, 8912, 54321, 65535]) {
      expect(redirectUriAllowedForClient(`http://127.0.0.1:${port}/callback`, claudeClient)).toBe(
        true,
      );
      expect(redirectUriAllowedForClient(`http://localhost:${port}/callback`, claudeClient)).toBe(
        true,
      );
    }
  });

  it("avviser privilegert port, feil bane og https mot malen", () => {
    for (const uri of [
      "http://127.0.0.1:80/callback",
      "http://127.0.0.1:54321/cb",
      "https://127.0.0.1:54321/callback",
      "http://192.168.1.5:54321/callback",
    ]) {
      expect(redirectUriAllowedForClient(uri, claudeClient)).toBe(false);
    }
  });

  it("gir ingen loopback til DCR, manual, ChatGPT eller Claude-lignende client_id", () => {
    const requested = "http://127.0.0.1:54321/callback";
    const others = [
      { ...claudeClient, registration_method: "dcr" },
      { ...claudeClient, registration_method: "manual" },
      {
        registration_method: "cimd",
        client_id: "https://chatgpt.com/oauth/client.json",
        metadata_url: "https://chatgpt.com/oauth/client.json",
        redirect_uris: officialTemplates,
      },
      {
        registration_method: "cimd",
        client_id: "https://claude.ai/oauth/claude-code-client-metadata-x",
        metadata_url: "https://claude.ai/oauth/claude-code-client-metadata-x",
        redirect_uris: officialTemplates,
      },
      { ...claudeClient, metadata_url: null },
    ];
    for (const client of others) {
      expect(allowsPortAgnosticLoopback(client)).toBe(false);
      expect(redirectUriAllowedForClient(requested, client)).toBe(false);
    }
  });

  it("eksakt registrert redirect fungerer fortsatt for alle", () => {
    const dcr = {
      registration_method: "dcr",
      client_id: "dcr_abc",
      metadata_url: null,
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    };
    expect(
      redirectUriAllowedForClient("https://chatgpt.com/connector_platform_oauth_redirect", dcr),
    ).toBe(true);
    expect(redirectUriAllowedForClient("https://chatgpt.com/annet", dcr)).toBe(false);
  });
});

describe("DCR-body måles i UTF-8-byte", () => {
  it("teller multibyte riktig", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("æøå")).toBe(6);
    expect(utf8ByteLength("🙂")).toBe(4);
    const nearLimit = "æ".repeat(4096); // 8192 byte = nøyaktig grensen
    expect(utf8ByteLength(nearLimit)).toBe(DCR_MAX_BODY_BYTES);
    expect(utf8ByteLength(nearLimit + "æ")).toBeGreaterThan(DCR_MAX_BODY_BYTES);
    expect(nearLimit.length).toBeLessThan(DCR_MAX_BODY_BYTES);
  });
});

describe("kildekontroll: DCR rydder og fail-closer", () => {
  const src = read("src/routes/api/public/oauth/register.ts");
  it("kaller opprydding og avbryter ved feil", () => {
    expect(src).toContain('db.rpc("oauth_cleanup_expired_clients")');
    expect(src).toContain("cleanup.error");
    expect(src.indexOf("cleanup.error")).toBeLessThan(src.indexOf('.from("oauth_clients")'));
    expect(src).toContain("content-length");
  });
});

// ---------------- Codex Work MCP: eksakt CIMD-identitet + loopback ----------------

describe("Codex loopback (chatgpt.com/oauth/codex/client.json)", () => {
  const codexUrl = "https://chatgpt.com/oauth/codex/client.json";
  const codexPayload = {
    client_id: codexUrl,
    client_uri: "https://chatgpt.com/codex",
    application_type: "native",
    redirect_uris: ["http://127.0.0.1/callback", "http://localhost/callback"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Codex",
    logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
  };

  const codexClient = {
    registration_method: "cimd",
    client_id: codexUrl,
    metadata_url: codexUrl,
    redirect_uris: codexPayload.redirect_uris,
  };

  it("velger den eksakte Codex-policyen, ikke den generelle ChatGPT-policyen", () => {
    const check = checkCimdUrl(codexUrl);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.policy.label).toBe("Codex");
    expect(check.policy.allowLoopbackCallback).toBe(true);
    // Den generelle ChatGPT-policyen er uendret og uten loopback.
    const generic = checkCimdUrl("https://chatgpt.com/oauth/client.json");
    expect(generic.ok).toBe(true);
    if (!generic.ok) return;
    expect(generic.policy.label).toBe("ChatGPT");
    expect(generic.policy.allowLoopbackCallback).toBeUndefined();
    expect(checkCimdUrl("https://chatgpt.com/oauth/annet/client.json").ok).toBe(true);
  });

  it("godtar hele den faktiske Codex-payloaden og velger none", () => {
    const check = checkCimdUrl(codexUrl);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const result = validateCimdMetadata(codexPayload, { url: codexUrl, policy: check.policy });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokenEndpointAuthMethod).toBe("none");
    expect(result.clientName).toBe("Codex");
    expect(result.redirectUris).toEqual(codexPayload.redirect_uris);
  });

  it("godtar den faktiske live-redirecten http://127.0.0.1:56304/callback", () => {
    expect(allowsPortAgnosticLoopback(codexClient)).toBe(true);
    expect(redirectUriAllowedForClient("http://127.0.0.1:56304/callback", codexClient)).toBe(true);
    expect(redirectUriAllowedForClient("http://localhost:56304/callback", codexClient)).toBe(true);
    for (const port of [1024, 65535]) {
      expect(redirectUriAllowedForClient(`http://127.0.0.1:${port}/callback`, codexClient)).toBe(
        true,
      );
    }
  });

  it("avviser ugyldige loopback-varianter for Codex", () => {
    for (const uri of [
      "http://127.0.0.1/callback", // portløs mal: eksakt registrert, derfor tillatt
      "http://127.0.0.1:80/callback",
      "http://127.0.0.1:1023/callback",
      "http://127.0.0.1:70000/callback",
      "http://127.0.0.1:56304/cb",
      "http://127.0.0.1:56304/callback?x=1",
      "http://127.0.0.1:56304/callback#a",
      "http://user:pw@127.0.0.1:56304/callback",
      "http://192.168.1.5:56304/callback",
      "https://127.0.0.1:56304/callback",
    ]) {
      const allowed = redirectUriAllowedForClient(uri, codexClient);
      // Portløs mal er eksakt registrert og derfor tillatt; alt annet avvises.
      expect(allowed).toBe(uri === "http://127.0.0.1/callback");
    }
  });

  it("gir ikke loopback til andre identiteter eller registreringsmetoder", () => {
    const requested = "http://127.0.0.1:56304/callback";
    for (const client of [
      { ...codexClient, registration_method: "dcr" },
      { ...codexClient, registration_method: "manual" },
      { ...codexClient, metadata_url: "https://chatgpt.com/oauth/client.json" },
      { ...codexClient, client_id: "https://chatgpt.com/oauth/client.json" },
      {
        registration_method: "cimd",
        client_id: "https://chatgpt.com/oauth/codexx/client.json",
        metadata_url: "https://chatgpt.com/oauth/codexx/client.json",
        redirect_uris: codexPayload.redirect_uris,
      },
    ]) {
      expect(allowsPortAgnosticLoopback(client)).toBe(false);
      expect(redirectUriAllowedForClient(requested, client)).toBe(false);
    }
  });

  it("krever at malen har samme vert og bane som forespørselen", () => {
    const mismatched = { ...codexClient, redirect_uris: ["http://localhost/cb"] };
    expect(redirectUriAllowedForClient("http://127.0.0.1:56304/callback", mismatched)).toBe(false);
    const httpsOnly = { ...codexClient, redirect_uris: ["https://chatgpt.com/callback"] };
    expect(redirectUriAllowedForClient("http://127.0.0.1:56304/callback", httpsOnly)).toBe(false);
  });
});
