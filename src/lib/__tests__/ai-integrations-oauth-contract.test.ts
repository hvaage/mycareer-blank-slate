// ============================================================
// Fase 2-korrigering: scope-/redirect-URI-regler i runtime, og at
// databasedefinisjonen håndhever de samme reglene.
// ============================================================

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OAUTH_SCOPES,
  isExactRedirectUri,
  isValidRedirectUriSet,
  isValidScopeSet,
  scopesWithinClient,
} from "@/lib/ai-integrations/oauth-contract";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Slår sammen ALLE migrasjoner som nevner uttrykket. Definisjonen kan bli
 * utvidet av en senere migrasjon, og da skal begge telle med.
 */
function migrationContaining(needle: string): string {
  const parts = readdirSync(MIGRATIONS_DIR)
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .filter((sql) => sql.includes(needle));
  if (parts.length === 0) throw new Error(`fant ingen migrasjon med ${needle}`);
  return parts.join("\n");
}

describe("scope-sett", () => {
  it("godtar bare de to definerte scopene", () => {
    expect(OAUTH_SCOPES).toEqual(["karriere.status.read", "karriere.workflow.run"]);
    expect(isValidScopeSet(["karriere.status.read"])).toBe(true);
    expect(isValidScopeSet([...OAUTH_SCOPES])).toBe(true);
    expect(isValidScopeSet(["karriere.admin"])).toBe(false);
  });

  it("avviser tomt sett, duplikater og ugyldige verdier", () => {
    expect(isValidScopeSet([])).toBe(false);
    expect(isValidScopeSet(["karriere.status.read", "karriere.status.read"])).toBe(false);
    expect(isValidScopeSet(["karriere.status.read", null])).toBe(false);
    expect(isValidScopeSet("karriere.status.read")).toBe(false);
    expect(isValidScopeSet(null)).toBe(false);
  });

  it("håndhever at grant-scopes ligger innenfor klientens tillatte", () => {
    expect(scopesWithinClient(["karriere.status.read"], [...OAUTH_SCOPES])).toBe(true);
    expect(scopesWithinClient([...OAUTH_SCOPES], ["karriere.status.read"])).toBe(false);
    expect(scopesWithinClient(["karriere.workflow.run"], ["karriere.status.read"])).toBe(false);
    expect(scopesWithinClient([], [...OAUTH_SCOPES])).toBe(false);
  });
});

describe("redirect-URI-er", () => {
  it("avviser tomt sett, tomme verdier og duplikater", () => {
    expect(isValidRedirectUriSet(["https://a.example/cb"])).toBe(true);
    expect(isValidRedirectUriSet([])).toBe(false);
    expect(isValidRedirectUriSet(["   "])).toBe(false);
    expect(isValidRedirectUriSet(["https://a.example/cb", "https://a.example/cb"])).toBe(false);
    expect(isValidRedirectUriSet(["https://a.example/cb", null])).toBe(false);
  });

  it("krever eksakt treff, aldri prefiks eller normalisering", () => {
    const registered = ["https://a.example/cb"];
    expect(isExactRedirectUri("https://a.example/cb", registered)).toBe(true);
    expect(isExactRedirectUri("https://a.example/cb/", registered)).toBe(false);
    expect(isExactRedirectUri("https://a.example/cb?x=1", registered)).toBe(false);
    expect(isExactRedirectUri("https://a.example/cb#f", registered)).toBe(false);
    expect(isExactRedirectUri("https://A.example/cb", registered)).toBe(false);
    expect(isExactRedirectUri("", registered)).toBe(false);
  });
});

describe("databasedefinisjonen speiler reglene", () => {
  const sql = migrationContaining("oauth_is_valid_scope_set");

  it("validerer scopes mot nøyaktig de to tillatte verdiene", () => {
    for (const scope of OAUTH_SCOPES) expect(sql).toContain(scope);
    expect(sql).toContain("array_position(p_scopes, NULL) IS NULL");
    expect(sql).toContain("count(DISTINCT s)");
  });

  it("validerer redirect-URI-er mot NULL, tomme og duplikater", () => {
    expect(sql).toContain("array_position(p_uris, NULL) IS NULL");
    expect(sql).toContain("btrim(u) = ''");
    expect(sql).toContain("count(DISTINCT u)");
  });

  it("binder scope-constraints til begge tabellene", () => {
    expect(sql).toContain("oauth_clients_allowed_scopes_valid");
    expect(sql).toContain("oauth_grants_scopes_valid");
    expect(sql).toContain("oauth_authorization_codes_scopes_valid");
    expect(sql).toContain("oauth_clients_redirect_uris_valid");
  });

  it("håndhever eierintegritet med sammensatt fremmednøkkel", () => {
    expect(sql).toContain("ai_integrations_id_user_id_key UNIQUE (id, user_id)");
    for (const name of [
      "oauth_grants_integration_owner_fkey",
      "capability_challenges_integration_owner_fkey",
      "oauth_authorization_codes_integration_owner_fkey",
    ]) {
      expect(sql).toContain(name);
    }
    expect(sql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
  });

  it("ratebegrensningen er atomisk, invoker og kun for service_role", () => {
    expect(sql).toContain("SECURITY INVOKER");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.claim_rate_check");
    expect(sql).toContain("FROM anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.claim_rate_check");
    expect(sql).toContain("TO service_role");
  });

  it("returnerer bare avgjørelse og antall, aldri rådata", () => {
    expect(sql).toContain("RETURNS TABLE (allowed boolean, attempts integer)");
  });
});
