// ============================================================
// Ren OAuth-kontrakt for AI-integrasjonen. Ingen I/O.
//
// Reglene her speiler databasens constraints (fase 2-korrigeringen) og er
// runtime-regelen OAuth-rutene i fase 3 SKAL bruke:
//
//   1. Et scope-sett må være ikke-tomt, uten duplikater, og et delmengde
//      av OAUTH_SCOPES. Databasen håndhever det samme via
//      public.oauth_is_valid_scope_set.
//   2. Et grant kan aldri få flere scopes enn klientens allowed_scopes.
//      Databasen kan ikke se den sammenhengen, så ruten MÅ kalle
//      `scopesWithinClient` før den skriver et grant eller en kode.
//   3. redirect_uri sammenlignes ALLTID eksakt (tegn for tegn) mot en
//      oppføring i klientens redirect_uris. Ingen prefiks, ingen
//      normalisering, ingen wildcard.
// ============================================================

/** De eneste gyldige scopene. Speiler databasens CHECK. */
export const OAUTH_SCOPES = ["karriere.status.read", "karriere.workflow.run"] as const;
export type OauthScope = (typeof OAUTH_SCOPES)[number];

export function isOauthScope(value: unknown): value is OauthScope {
  return typeof value === "string" && (OAUTH_SCOPES as readonly string[]).includes(value);
}

/** Ikke-tomt, uten duplikater, kun kjente scopes. */
export function isValidScopeSet(scopes: unknown): scopes is OauthScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  if (!scopes.every(isOauthScope)) return false;
  return new Set(scopes).size === scopes.length;
}

/** Runtime-regel: forespurte scopes må ligge innenfor klientens tillatte. */
export function scopesWithinClient(requested: unknown, clientAllowed: unknown): boolean {
  if (!isValidScopeSet(requested) || !isValidScopeSet(clientAllowed)) return false;
  const allowed = new Set(clientAllowed);
  return requested.every((s) => allowed.has(s));
}

/** Ikke-tomt, uten duplikater eller tomme strenger. Speiler databasens CHECK. */
export function isValidRedirectUriSet(uris: unknown): uris is string[] {
  if (!Array.isArray(uris) || uris.length === 0) return false;
  if (!uris.every((u) => typeof u === "string" && u.trim() !== "")) return false;
  return new Set(uris).size === uris.length;
}

/** Runtime-regel: eksakt treff, aldri prefiks eller normalisering. */
export function isExactRedirectUri(requested: unknown, registered: unknown): boolean {
  if (typeof requested !== "string" || requested === "") return false;
  if (!isValidRedirectUriSet(registered)) return false;
  return registered.some((uri) => uri === requested);
}
