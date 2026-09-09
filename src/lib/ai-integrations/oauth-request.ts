// ============================================================
// Ren validering av authorization request-parametre. Ingen I/O.
//
// Alt som kan avgjøres uten database avgjøres her, slik at rutene bare
// gjør oppslag når forespørselen allerede er formelt riktig.
// ============================================================

import { isValidScopeSet, scopesWithinClient } from "./oauth-contract";
import { redirectUriAllowedForClient } from "./oauth-client-policy";

export type AuthorizeParams = {
  response_type?: string | null;
  client_id?: string | null;
  redirect_uri?: string | null;
  scope?: string | null;
  state?: string | null;
  resource?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
};

export type AuthorizeError = {
  /** OAuth-standardkode. */
  error:
    | "invalid_request"
    | "unauthorized_client"
    | "unsupported_response_type"
    | "invalid_scope"
    | "server_error"
    | "access_denied";
  /** Om feilen kan sendes tilbake til redirect_uri, eller må vises som side. */
  redirectable: boolean;
  description: string;
};

export type AuthorizeValidation =
  | { ok: true; value: ValidAuthorizeRequest }
  | { ok: false; error: AuthorizeError };

export type ValidAuthorizeRequest = {
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  state: string;
  resource: string;
  code_challenge: string;
};

/** Scope-strengen er mellomromseparert etter RFC 6749. */
export function parseScopeString(scope: unknown): string[] | null {
  if (typeof scope !== "string") return null;
  const parts = scope.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts;
}

const CODE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

/**
 * Steg 1: alt som ikke krever klientoppslag. Feil her kan ALDRI
 * videresendes til en redirect_uri, fordi vi ikke har validert den ennå.
 */
export function validateAuthorizeShape(params: AuthorizeParams): AuthorizeValidation {
  const fail = (
    error: AuthorizeError["error"],
    description: string,
    redirectable = false,
  ): AuthorizeValidation => ({ ok: false, error: { error, redirectable, description } });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Bare response_type=code støttes.");
  }
  if (typeof params.client_id !== "string" || params.client_id.trim() === "") {
    return fail("invalid_request", "client_id mangler.");
  }
  if (typeof params.redirect_uri !== "string" || params.redirect_uri.trim() === "") {
    return fail("invalid_request", "redirect_uri mangler.");
  }
  if (typeof params.state !== "string" || params.state.length < 8 || params.state.length > 512) {
    return fail("invalid_request", "state mangler eller har ugyldig lengde.");
  }
  if (typeof params.resource !== "string" || params.resource.trim() === "") {
    return fail("invalid_request", "resource mangler.");
  }
  if (params.code_challenge_method !== "S256") {
    return fail("invalid_request", "code_challenge_method må være S256.");
  }
  if (typeof params.code_challenge !== "string" || !CODE_CHALLENGE.test(params.code_challenge)) {
    return fail("invalid_request", "code_challenge mangler eller er ugyldig.");
  }
  const scopes = parseScopeString(params.scope);
  if (!scopes || !isValidScopeSet(scopes)) {
    return fail("invalid_scope", "Ukjent eller tomt scope.");
  }

  return {
    ok: true,
    value: {
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      scopes,
      state: params.state,
      resource: params.resource,
      code_challenge: params.code_challenge,
    },
  };
}

export type ClientRecord = {
  id: string;
  client_id: string;
  client_name: string;
  client_type: string;
  is_active: boolean;
  redirect_uris: string[];
  allowed_scopes: string[];
  /** manual | cimd | dcr — avgjør om portagnostisk loopback er tillatt. */
  registration_method?: string | null;
  metadata_url?: string | null;
};

/**
 * Steg 2: mot en faktisk registrert klient og kanonisk resource.
 * `redirectable` er først sann når redirect_uri er bekreftet eksakt.
 */
export function validateAgainstClient(
  request: ValidAuthorizeRequest,
  client: ClientRecord | null,
  canonicalResource: string,
): AuthorizeValidation {
  const fail = (
    error: AuthorizeError["error"],
    description: string,
    redirectable = false,
  ): AuthorizeValidation => ({ ok: false, error: { error, redirectable, description } });

  if (!client || !client.is_active) {
    return fail("unauthorized_client", "Ukjent klient.");
  }
  if (!redirectUriAllowedForClient(request.redirect_uri, client)) {
    // Eksakt treff for alle. Eneste unntak: den verifiserte Claude Code-
    // CIMD-klienten, som deklarerer portløs loopback-mal og bruker en
    // tilfeldig port i selve forespørselen.
    return fail("invalid_request", "redirect_uri er ikke registrert for klienten.");
  }
  if (request.resource !== canonicalResource) {
    return fail("invalid_request", "resource peker ikke på denne serveren.", true);
  }
  if (!scopesWithinClient(request.scopes, client.allowed_scopes)) {
    return fail("invalid_scope", "Klienten har ikke tilgang til dette scopet.", true);
  }
  return { ok: true, value: request };
}

/** Bygger en OAuth-feilredirect med bevart state. */
export function errorRedirectUrl(
  redirectUri: string,
  error: string,
  state: string,
  issuer?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("state", state);
  if (issuer) url.searchParams.set("iss", issuer);
  return url.toString();
}

export function successRedirectUrl(
  redirectUri: string,
  code: string,
  state: string,
  issuer: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

/** Norsk forklaring per scope, brukt på samtykkesiden. */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "karriere.status.read": "Lese status på karrierearbeidet ditt: søknader, frister og neste steg.",
  "karriere.workflow.run": "Starte arbeidsflyter du selv har satt opp, som å forberede en søknad.",
};
