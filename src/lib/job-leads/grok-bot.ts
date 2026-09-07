/**
 * Klientsikre hjelpere for Grok Bot-jobbimport.
 * Ingen hemmeligheter her — mal-URL og nøkler leses kun i serverfunksjoner.
 */

export const INBOUND_JOB_DOMAIN = "jobb.karrierenmin.no";

/** Lokal fallback når GROK_TEMPLATE_URL ikke er satt. Offentlig URL, ikke en hemmelighet. */
export const DEFAULT_GROK_TEMPLATE_URL = "https://grok.com/";

export const GROK_SETUP_TTL_MS = 45 * 60 * 1000;
export const GROK_SETUP_CODE_LENGTH = 8;
export const GROK_SETUP_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type GrokSetupStatus = "pending_alias" | "pending_verify" | "active";

export type GrokBotUiState = "inactive" | "pending_verify" | "active";

export type GrokSetupSessionView = {
  setup_code: string;
  expires_at: string;
  grok_template_url: string;
};

export type GrokSetupStatusResult = {
  alias: string | null;
  token: string | null;
  is_active: boolean;
  last_inbound_at: string | null;
  verified_at: string | null;
  status: GrokSetupStatus;
  setup_session: GrokSetupSessionView | null;
};

export function formatInboundAlias(token: string): string {
  return `${token.trim().toLowerCase()}@${INBOUND_JOB_DOMAIN}`;
}

export function generateGrokSetupCode(
  randomValues: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    crypto.getRandomValues(bytes),
): string {
  const bytes = randomValues(new Uint8Array(GROK_SETUP_CODE_LENGTH));
  const alphabet = GROK_SETUP_CODE_ALPHABET;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function isSetupSessionOpen(
  session: { expires_at: string; consumed_at: string | null },
  now: Date = new Date(),
): boolean {
  if (session.consumed_at) return false;
  return new Date(session.expires_at).getTime() > now.getTime();
}

export function inboundMatchesAlias(
  toAddress: string | null | undefined,
  token: string,
): boolean {
  if (!toAddress || !token) return false;
  const expected = formatInboundAlias(token);
  const normalized = toAddress.trim().toLowerCase();
  return normalized === expected || normalized.includes(expected);
}

export function deriveGrokSetupStatus(input: {
  hasAlias: boolean;
  verifiedAt: string | null;
  isActive: boolean;
}): GrokSetupStatus {
  if (!input.hasAlias) return "pending_alias";
  if (input.verifiedAt && input.isActive) return "active";
  return "pending_verify";
}

export function deriveGrokBotUiState(input: {
  status: GrokSetupStatus;
  is_active: boolean;
  has_open_setup_session: boolean;
}): GrokBotUiState {
  if (input.status === "active" && input.is_active) return "active";
  if (input.has_open_setup_session) return "pending_verify";
  return "inactive";
}

export function resolveGrokTemplateUrl(envValue: string | undefined | null): string {
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_GROK_TEMPLATE_URL;
}
