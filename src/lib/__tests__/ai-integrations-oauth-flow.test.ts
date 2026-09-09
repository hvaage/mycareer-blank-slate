// ============================================================
// Fase 3: OAuth 2.1/PKCE.
//
// Testene dekker discovery-kontrakten, validering av authorization
// request, PKCE, signerte tilstander, CSRF, access token-verifisering,
// no-store-krav, lekkasjekontroll og databasekontrakten for de atomiske
// prosedyrene.
// ============================================================

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  normalizePublicOrigin,
  oauthUrls,
  OAUTH_PATHS,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CODE_TTL_SECONDS,
} from "@/lib/ai-integrations/oauth-config.server";
import {
  isValidCodeChallenge,
  isValidCodeVerifier,
  sha256B64Url,
  sha256Hex,
  timingSafeEqual,
} from "@/lib/ai-integrations/oauth-crypto.server";
import {
  errorRedirectUrl,
  successRedirectUrl,
  parseScopeString,
  validateAgainstClient,
  validateAuthorizeShape,
  SCOPE_DESCRIPTIONS,
  type ClientRecord,
} from "@/lib/ai-integrations/oauth-request";
import {
  issueOauthAccessToken,
  verifyOauthAccessToken,
} from "@/lib/ai-integrations/oauth-access-token.server";
import {
  isAllowlistedReturnPath,
  openAuthorizeRequest,
  sealAuthorizeRequest,
  sealCsrfToken,
  sealReturnState,
  openReturnState,
  verifyCsrfToken,
  csrfCookieHeader,
  readCookie,
} from "@/lib/ai-integrations/oauth-state.server";
import { isRegistrableRedirectUri } from "@/routes/api/public/oauth/register";
import { OAUTH_SCOPES } from "@/lib/ai-integrations/oauth-contract";

/** Kommentarer teller ikke som kontrakt — bare faktisk kode. */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");
}

const ORIGIN = "https://karrierenmin.no";
const RESOURCE = `${ORIGIN}${OAUTH_PATHS.resource}`;
const ISSUER = ORIGIN;

const CLIENT: ClientRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  client_id: "chatgpt-karrierenmin",
  client_name: "ChatGPT",
  client_type: "public",
  is_active: true,
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  allowed_scopes: ["karriere.status.read", "karriere.workflow.run"],
};

const VERIFIER = "a".repeat(43);

function baseParams(overrides: Record<string, string | null> = {}) {
  return {
    response_type: "code",
    client_id: CLIENT.client_id,
    redirect_uri: CLIENT.redirect_uris[0]!,
    scope: "karriere.status.read",
    state: "state-value-1234",
    resource: RESOURCE,
    code_challenge: "B".repeat(43),
    code_challenge_method: "S256",
    ...overrides,
  };
}

beforeAll(() => {
  process.env["AI_INTEGRATION_OAUTH_SECRET"] = "x".repeat(48);
  process.env["PUBLIC_APP_ORIGIN"] = ORIGIN;
});

// ---------- A. kanonisk origin og discovery ----------

describe("kanonisk origin", () => {
  it("godtar bare ren HTTPS-origin", () => {
    expect(normalizePublicOrigin("https://karrierenmin.no").ok).toBe(true);
    expect(normalizePublicOrigin("https://karrierenmin.no/").ok).toBe(true);
  });

  it("avviser http, sti, spørring, fragment, tomt og søppel", () => {
    for (const bad of [
      "",
      "  ",
      "http://karrierenmin.no",
      "https://karrierenmin.no/app",
      "https://karrierenmin.no?a=1",
      "https://karrierenmin.no#x",
      "https://u:p@karrierenmin.no",
      "ikke-en-url",
    ]) {
      expect(normalizePublicOrigin(bad).ok, bad).toBe(false);
    }
  });

  it("utleder aldri origin fra Host — kun miljøvariabelen leses", () => {
    const source = stripComments(
      readFileSync("src/lib/ai-integrations/oauth-config.server.ts", "utf8"),
    );
    expect(source).toContain('process.env["PUBLIC_APP_ORIGIN"]');
    expect(source.toLowerCase()).not.toContain("x-forwarded-host");
  });

  it("bygger kanoniske adresser av origin", () => {
    const urls = oauthUrls(ORIGIN);
    expect(urls.issuer).toBe(ORIGIN);
    expect(urls.resource).toBe(RESOURCE);
    expect(urls.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(urls.token_endpoint).toBe(`${ORIGIN}/api/public/oauth/token`);
  });
});

describe("discovery-kontrakt", () => {
  const asMeta = stripComments(
    readFileSync("src/routes/[.]well-known/oauth-authorization-server.ts", "utf8"),
  );
  const prMeta = stripComments(
    readFileSync("src/routes/[.]well-known/oauth-protected-resource.ts", "utf8"),
  );

  it("annonserer S256 og bare det som er implementert", () => {
    expect(asMeta).toContain('code_challenge_methods_supported: ["S256"]');
    expect(asMeta).toContain('grant_types_supported: ["authorization_code", "refresh_token"]');
    expect(asMeta).toContain('token_endpoint_auth_methods_supported: ["none"]');
    expect(asMeta).toContain("resource_indicators_supported: true");
  });

  it("setter iss-parameteret bare fordi iss faktisk returneres overalt", () => {
    expect(asMeta).toContain("authorization_response_iss_parameter_supported: true");
    const url = successRedirectUrl(CLIENT.redirect_uris[0]!, "c", "s", ORIGIN);
    expect(new URL(url).searchParams.get("iss")).toBe(ORIGIN);
    const denied = errorRedirectUrl(CLIENT.redirect_uris[0]!, "access_denied", "s", ORIGIN);
    expect(new URL(denied).searchParams.get("iss")).toBe(ORIGIN);
  });

  it("annonserer ikke OIDC, openid, email eller userinfo", () => {
    for (const forbidden of ["openid", "userinfo", "id_token", "email"]) {
      expect(asMeta.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("annonserer registration_endpoint kun når DCR er slått på", () => {
    expect(asMeta).toContain("if (dynamicRegistrationEnabled())");
  });

  it("protected-resource peker på kanonisk resource og autorisasjonsserver", () => {
    expect(prMeta).toContain("resource: urls.resource");
    expect(prMeta).toContain("authorization_servers: [urls.issuer]");
    expect(prMeta).toContain('bearer_methods_supported: ["header"]');
  });
});

// ---------- B. validering av authorization request ----------

describe("authorization request", () => {
  it("godtar en korrekt forespørsel", () => {
    const shape = validateAuthorizeShape(baseParams());
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(validateAgainstClient(shape.value, CLIENT, RESOURCE).ok).toBe(true);
  });

  it("avviser feil response_type", () => {
    const r = validateAuthorizeShape(baseParams({ response_type: "token" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error).toBe("unsupported_response_type");
  });

  it("krever state med fornuftig lengde", () => {
    for (const state of [null, "", "kort"]) {
      const r = validateAuthorizeShape(baseParams({ state }));
      expect(r.ok).toBe(false);
    }
  });

  it("krever S256 og gyldig code_challenge", () => {
    expect(validateAuthorizeShape(baseParams({ code_challenge_method: "plain" })).ok).toBe(false);
    expect(validateAuthorizeShape(baseParams({ code_challenge_method: null })).ok).toBe(false);
    expect(validateAuthorizeShape(baseParams({ code_challenge: "kort" })).ok).toBe(false);
    expect(validateAuthorizeShape(baseParams({ code_challenge: null })).ok).toBe(false);
  });

  it("avviser ukjent og tomt scope", () => {
    expect(validateAuthorizeShape(baseParams({ scope: "" })).ok).toBe(false);
    expect(validateAuthorizeShape(baseParams({ scope: "admin.alt" })).ok).toBe(false);
    expect(parseScopeString("a  b")).toEqual(["a", "b"]);
  });

  it("avviser manglende resource", () => {
    expect(validateAuthorizeShape(baseParams({ resource: null })).ok).toBe(false);
  });

  it("avviser feil resource, men da kan feilen sendes til klienten", () => {
    const shape = validateAuthorizeShape(baseParams({ resource: "https://annet.no/mcp" }));
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    const r = validateAgainstClient(shape.value, CLIENT, RESOURCE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.error).toBe("invalid_request");
      expect(r.error.redirectable).toBe(true);
    }
  });

  it("avviser ukjent og inaktiv klient", () => {
    const shape = validateAuthorizeShape(baseParams());
    if (!shape.ok) throw new Error("skulle vært gyldig");
    expect(validateAgainstClient(shape.value, null, RESOURCE).ok).toBe(false);
    expect(validateAgainstClient(shape.value, { ...CLIENT, is_active: false }, RESOURCE).ok).toBe(
      false,
    );
  });

  it("avviser redirect-mismatch og åpen videresending, uten å kunne redirecte", () => {
    for (const bad of [
      "https://evil.example.com/cb",
      "https://chatgpt.com/connector_platform_oauth_redirect/",
      "https://chatgpt.com/connector_platform_oauth_redirect?x=1",
      "https://chatgpt.com/connector_platform_oauth_redirect#f",
      "https://chatgpt.com.evil.no/connector_platform_oauth_redirect",
    ]) {
      const shape = validateAuthorizeShape(baseParams({ redirect_uri: bad }));
      if (!shape.ok) throw new Error("formen skal være gyldig");
      const r = validateAgainstClient(shape.value, CLIENT, RESOURCE);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.redirectable, bad).toBe(false);
    }
  });

  it("avviser scope utenfor klientens tillatte", () => {
    const shape = validateAuthorizeShape(baseParams({ scope: "karriere.workflow.run" }));
    if (!shape.ok) throw new Error("skulle vært gyldig");
    const narrow = { ...CLIENT, allowed_scopes: ["karriere.status.read"] };
    const r = validateAgainstClient(shape.value, narrow, RESOURCE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error).toBe("invalid_scope");
  });

  it("avslag bevarer opprinnelig state", () => {
    const url = new URL(
      errorRedirectUrl(CLIENT.redirect_uris[0]!, "access_denied", "abc123", ORIGIN),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("abc123");
  });

  it("hvert scope har en norsk forklaring", () => {
    for (const scope of OAUTH_SCOPES) {
      expect(SCOPE_DESCRIPTIONS[scope]?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

// ---------- C. PKCE ----------

describe("PKCE S256", () => {
  it("regner BASE64URL(SHA256(verifier)) uten padding", async () => {
    // RFC 7636 vedlegg B.
    const challenge = await sha256B64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(challenge).not.toContain("=");
  });

  it("godtar bare verifier med riktig lengde og alfabet", () => {
    expect(isValidCodeVerifier(VERIFIER)).toBe(true);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${"a".repeat(42)}/`)).toBe(false);
    expect(isValidCodeVerifier(null)).toBe(false);
    expect(isValidCodeVerifier("")).toBe(false);
  });

  it("kjenner igjen gyldig challenge-format", async () => {
    expect(isValidCodeChallenge(await sha256B64Url(VERIFIER))).toBe(true);
    expect(isValidCodeChallenge("kort")).toBe(false);
  });

  it("feil verifier gir en annen challenge", async () => {
    const a = await sha256B64Url(VERIFIER);
    const b = await sha256B64Url("b".repeat(43));
    expect(a).not.toBe(b);
  });

  it("koden lagres bare som hash", async () => {
    const hash = await sha256Hex("hemmelig-kode");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("hemmelig");
  });
});

// ---------- D. signerte tilstander og CSRF ----------

describe("signerte tilstander", () => {
  const sealedInput = {
    client_row_id: CLIENT.id,
    client_id: CLIENT.client_id,
    client_name: CLIENT.client_name,
    redirect_uri: CLIENT.redirect_uris[0]!,
    scopes: ["karriere.status.read"],
    state: "state-value-1234",
    resource: RESOURCE,
    code_challenge: "B".repeat(43),
  };

  it("request-token kan åpnes igjen, men ikke tukles med", async () => {
    const token = await sealAuthorizeRequest(sealedInput);
    expect(token).toBeTruthy();
    expect(await openAuthorizeRequest(token)).toMatchObject(sealedInput);
    expect(await openAuthorizeRequest(`${token}x`)).toBeNull();
    expect(await openAuthorizeRequest("tull")).toBeNull();
    expect(await openAuthorizeRequest(null)).toBeNull();
  });

  it("tilstander med ett formål kan ikke brukes som et annet", async () => {
    const rt = (await sealAuthorizeRequest(sealedInput))!;
    expect(await openReturnState(rt)).toBeNull();
    const rs = (await sealReturnState("/oauth/authorize?client_id=a"))!;
    expect(await openAuthorizeRequest(rs)).toBeNull();
  });

  it("returtilstand er allowlistet og aldri en åpen videresending", async () => {
    expect(isAllowlistedReturnPath("/oauth/authorize?x=1")).toBe(true);
    for (const bad of [
      "https://evil.no",
      "//evil.no",
      "/dashboard",
      "/oauth/authorize/../admin",
      42,
    ]) {
      expect(isAllowlistedReturnPath(bad), String(bad)).toBe(false);
    }
    expect(await sealReturnState("https://evil.no")).toBeNull();
  });

  it("CSRF-token er bundet til bruker og forespørsel, og krever cookie", async () => {
    const rt = (await sealAuthorizeRequest(sealedInput))!;
    const csrf = (await sealCsrfToken("bruker-1", rt))!;
    expect(await verifyCsrfToken(csrf, csrf, "bruker-1", rt)).toBe(true);
    expect(await verifyCsrfToken(csrf, csrf, "bruker-2", rt)).toBe(false);
    expect(await verifyCsrfToken(csrf, csrf, "bruker-1", "annen")).toBe(false);
    expect(await verifyCsrfToken(csrf, "annen-cookie", "bruker-1", rt)).toBe(false);
    expect(await verifyCsrfToken(null, csrf, "bruker-1", rt)).toBe(false);
    expect(await verifyCsrfToken(csrf, null, "bruker-1", rt)).toBe(false);
  });

  it("CSRF-cookien er HttpOnly, Secure og SameSite=Strict", () => {
    const header = csrfCookieHeader("abc");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
  });

  it("leser cookie riktig", () => {
    const req = new Request("https://x.no", { headers: { cookie: "a=1; km_oauth_csrf=verdi" } });
    expect(readCookie(req, "km_oauth_csrf")).toBe("verdi");
    expect(readCookie(req, "finnes-ikke")).toBeNull();
  });

  it("sammenligning er tidskonstant i form", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

// ---------- E. access token ----------

describe("OAuth access token", () => {
  const issueInput = {
    integrationId: "int-1",
    userId: "user-1",
    provider: "claude" as const,
    resource: RESOURCE,
    issuer: ORIGIN,
    clientId: CLIENT.client_id,
    grantId: "grant-1",
    scopes: ["karriere.status.read"],
  };

  it("inneholder alle påkrevde felt og 60 minutters levetid", async () => {
    const issued = (await issueOauthAccessToken(issueInput))!;
    expect(issued.expiresIn).toBe(OAUTH_ACCESS_TOKEN_TTL_SECONDS);
    expect(OAUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    const verified = await verifyOauthAccessToken(issued.token, { resource: RESOURCE });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    for (const key of [
      "iid",
      "sub",
      "provider",
      "aud",
      "resource",
      "iat",
      "exp",
      "jti",
      "grant_id",
      "scopes",
      "client_id",
      "typ",
    ]) {
      expect(verified.payload, key).toHaveProperty(key);
    }
  });

  it("avviser tuklet signatur", async () => {
    const issued = (await issueOauthAccessToken(issueInput))!;
    const [body] = issued.token.split(".");
    const forged = `${body}.${"A".repeat(43)}`;
    const r = await verifyOauthAccessToken(forged, { resource: RESOURCE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("avviser feil audience/resource", async () => {
    const issued = (await issueOauthAccessToken(issueInput))!;
    const r = await verifyOauthAccessToken(issued.token, { resource: "https://annen.no/mcp" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("audience");
  });

  it("avviser utløpt token", async () => {
    const issued = (await issueOauthAccessToken({ ...issueInput, ttlSeconds: 1 }))!;
    const later = new Date(Date.now() + 5000);
    const r = await verifyOauthAccessToken(issued.token, { resource: RESOURCE, issuer: ISSUER, now: later });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("avviser manglende scope", async () => {
    const issued = (await issueOauthAccessToken(issueInput))!;
    const r = await verifyOauthAccessToken(issued.token, {
      resource: RESOURCE,
      requiredScope: "karriere.workflow.run",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scope");
  });

  it("er tydelig skilt fra det gamle agenttokenet", async () => {
    process.env["AI_INTEGRATION_TOKEN_SECRET"] = "y".repeat(48);
    const { issueAgentToken } = await import("@/lib/ai-integrations/token.server");
    const legacy = (await issueAgentToken({
      integrationId: "int-1",
      userId: "user-1",
      provider: "claude",
    }))!;
    // Et legacy claim-token skal ALDRI passere som OAuth-token.
    const r = await verifyOauthAccessToken(legacy.token, { resource: RESOURCE });
    expect(r.ok).toBe(false);

    // ...og et OAuth-token skal ikke passere som agenttoken.
    const { verifyAgentToken } = await import("@/lib/ai-integrations/token.server");
    const issued = (await issueOauthAccessToken(issueInput))!;
    expect((await verifyAgentToken(issued.token)).ok).toBe(false);
  });

  it("uten hemmelighet utstedes ingen token", async () => {
    const saved = process.env["AI_INTEGRATION_OAUTH_SECRET"];
    delete process.env["AI_INTEGRATION_OAUTH_SECRET"];
    expect(await issueOauthAccessToken(issueInput)).toBeNull();
    const r = await verifyOauthAccessToken("a.b", { resource: RESOURCE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_configured");
    process.env["AI_INTEGRATION_OAUTH_SECRET"] = saved;
  });
});

// ---------- F. rutekontrakter (kildekontroll) ----------

const routeSources: Record<string, string> = {
  token: readFileSync("src/routes/api/public/oauth/token.ts", "utf8"),
  revoke: readFileSync("src/routes/api/public/oauth/revoke.ts", "utf8"),
  register: readFileSync("src/routes/api/public/oauth/register.ts", "utf8"),
  consent: readFileSync("src/routes/api/oauth/consent.ts", "utf8"),
  prepare: readFileSync("src/routes/api/public/oauth/prepare.ts", "utf8"),
};

describe("token- og revokeringsruter", () => {
  it("token krever form-encoding og avviser klientautentisering", () => {
    expect(routeSources.token).toContain("application/x-www-form-urlencoded");
    expect(routeSources.token).toContain('client_type !== "public"');
  });

  it("token validerer resource mot kanonisk verdi", () => {
    expect(routeSources.token).toContain("resource !== urls.resource");
  });

  it("alle tokensvar er no-store", () => {
    expect(routeSources.token).toContain('"Cache-Control": "no-store"');
    expect(routeSources.token).toContain('Pragma: "no-cache"');
    expect(routeSources.revoke).toContain('"Cache-Control": "no-store"');
    expect(routeSources.consent).toContain('"Cache-Control": "no-store"');
  });

  it("token gir generisk invalid_grant for alle avvisninger", () => {
    expect(routeSources.token).toContain('oauthError(400, "invalid_grant")');
  });

  it("revokering er idempotent og svarer 200 for ukjent token", () => {
    expect(routeSources.revoke).toContain("status: 200");
    expect(routeSources.revoke).not.toContain("unknown_token");
  });

  it("samtykke godkjennes bare med POST og CSRF", () => {
    expect(routeSources.consent).toContain("verifyCsrfToken");
    expect(routeSources.consent).toContain('decision === "deny"');
    // GET-handleren utsteder aldri en kode.
    const getBlock = routeSources.consent!.split("POST: async")[0]!;
    expect(getBlock).not.toContain("oauth_authorization_codes");
  });

  it("samtykke tar aldri user_id eller integration_id på tro fra klienten", () => {
    expect(routeSources.consent).toContain("integrations.find((row) => row.id === requested)");
    expect(routeSources.consent).toContain("user_id: auth.userId");
  });

  it("koden lagres bare som hash og lever i 60 sekunder", () => {
    expect(routeSources.consent).toContain("code_hash: codeHash");
    expect(routeSources.consent).not.toContain("code_plain");
    expect(OAUTH_CODE_TTL_SECONDS).toBe(60);
  });

  it("DCR er av som standard og godtar bare allowlistede callbacker", () => {
    expect(routeSources.register).toContain("if (!dynamicRegistrationEnabled())");
    expect(isRegistrableRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(
      true,
    );
    for (const bad of [
      "https://klient.no/cb",
      "http://klient.no/cb",
      "https://chatgpt.com/connector_platform_oauth_redirect#frag",
      "https://klient.no/*",
      "http://localhost:3000/cb",
      "https://127.0.0.1/cb",
      "https://10.0.0.5/cb",
      "https://192.168.1.5/cb",
      "",
      null,
    ]) {
      expect(isRegistrableRedirectUri(bad), String(bad)).toBe(false);
    }
  });

  it("DCR utsteder aldri client secret", () => {
    expect(routeSources.register).toContain('client_type: "public"');
    expect(routeSources.register).not.toContain("client_secret_hash");
  });
});

describe("lekkasjekontroll", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
    });
  }

  const oauthFiles = [
    ...walk("src/routes/api/public/oauth"),
    ...walk("src/routes/api/oauth"),
    "src/routes/oauth.authorize.tsx",
    ...walk("src/lib/ai-integrations"),
  ];

  it("ingen OAuth-fil logger token, kode eller verifier", () => {
    for (const file of oauthFiles) {
      const source = readFileSync(file, "utf8");
      const logging = source.match(/console\.(log|info|warn|error)\([^)]*/g) ?? [];
      for (const call of logging) {
        expect(/token|code|verifier|secret|refresh/i.test(call), `${file}: ${call}`).toBe(false);
      }
    }
  });

  it("ingen tjenestenøkkel eller hemmelighet ligger i klientkoden", () => {
    const page = readFileSync("src/routes/oauth.authorize.tsx", "utf8");
    expect(page).not.toContain("SERVICE_ROLE");
    expect(page).not.toContain("AI_INTEGRATION_OAUTH_SECRET");
    expect(page).not.toContain("client.server");
  });

  it("access token legges aldri i en URL", () => {
    expect(routeSources.token).not.toContain('searchParams.set("access_token"');
    const page = readFileSync("src/routes/oauth.authorize.tsx", "utf8");
    expect(page).not.toContain("access_token=");
  });

  it("adminklienten importeres alltid inne i funksjoner", () => {
    const store = readFileSync("src/lib/ai-integrations/oauth-store.server.ts", "utf8");
    expect(store).toContain('await import("@/integrations/supabase/client.server")');
    expect(store).not.toMatch(/^import .*client\.server/m);
  });
});

// ---------- G. databasekontrakt ----------

describe("atomiske databaseprosedyrer", () => {
  const migrationsDir = "supabase/migrations";
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n");
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("har prosedyrer for innløsning, rotasjon og revokering", () => {
    for (const fn of [
      "oauth_redeem_authorization_code",
      "oauth_rotate_refresh_token",
      "oauth_revoke_grants",
      "oauth_revoke_refresh_token",
    ]) {
      expect(withoutComments).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });

  it("prosedyrene er SECURITY INVOKER med fast search_path", () => {
    for (const fn of [
      "oauth_redeem_authorization_code",
      "oauth_rotate_refresh_token",
      "oauth_revoke_grants",
      "oauth_revoke_refresh_token",
    ]) {
      const head = withoutComments
        .split(`CREATE OR REPLACE FUNCTION public.${fn}`)[1]!
        .slice(0, 1200);
      expect(head, fn).toContain("SECURITY INVOKER");
      expect(head, fn).toContain("SET search_path = public, pg_temp");
      expect(head, fn).not.toContain("SECURITY DEFINER");
    }
  });

  it("bruker advisory lock mot samtidighet", () => {
    expect(withoutComments).toContain("pg_advisory_xact_lock(hashtextextended(p_code_hash");
    expect(withoutComments).toContain("pg_advisory_xact_lock(hashtextextended(p_token_hash");
  });

  it("kun service_role kan kjøre dem", () => {
    for (const fn of [
      "oauth_redeem_authorization_code",
      "oauth_rotate_refresh_token",
      "oauth_revoke_grants",
      "oauth_revoke_refresh_token",
    ]) {
      expect(withoutComments).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO service_role`),
      );
      expect(withoutComments).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM PUBLIC, anon, authenticated`),
      );
    }
  });

  it("gjenbruk av kode og refresh token trekker grantet", () => {
    expect(withoutComments).toContain("'authorization_code_reuse'");
    expect(withoutComments).toContain("'refresh_token_reuse'");
  });

  it("frakobling trekker grants for hele integrasjonen", () => {
    const route = readFileSync("src/routes/api/ai-integrations/index.ts", "utf8");
    expect(route).toContain('rpc("oauth_revoke_grants"');
    expect(route).toContain("p_ai_integration_id: updated.id");
  });
});
