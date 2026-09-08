// ============================================================
// Ren kontrakt for claim (aktivering) av en AI-integrasjon.
// Ingen I/O. Deles av serverrute og tester.
//
// Sikkerhetsregler som gjelder hele filen:
//   - engangskoden logges aldri, verken rå eller normalisert
//   - alle avvisninger bruker samme generiske feilmelding
//   - capabilities tas kun fra en streng allowlist
// ============================================================

import {
  AI_PROVIDERS,
  isValidSetupCodeFormat,
  type AiCapabilities,
  type AiProvider,
} from "@/lib/ai-integrations/contract";

/** Én felles avvisning. Ingen variant røper hvorfor claim feilet. */
export const CLAIM_REJECTION = {
  code: "invalid_claim",
  message: "Koden kan ikke brukes. Lag en ny kode i Karrierenmin og prøv igjen.",
} as const;

/** Fjerner bindestreker/mellomrom og gjør om til versaler. */
export function normalizeSetupCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export type ClaimInput = { provider: AiProvider; code: string };
export type ClaimParse = { ok: true; value: ClaimInput } | { ok: false };

/** Validerer format FØR noen databasekontakt. */
export function parseClaimInput(body: unknown): ClaimParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;

  const provider = input["provider"];
  if (typeof provider !== "string" || !(AI_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false };
  }

  const rawCode = input["setup_code"] ?? input["code"];
  if (typeof rawCode !== "string" || rawCode.length > 128) return { ok: false };

  const code = normalizeSetupCode(rawCode);
  if (!isValidSetupCodeFormat(code)) return { ok: false };

  // user_id og integration_id fra forespørselen ignoreres alltid.
  return { ok: true, value: { provider: provider as AiProvider, code } };
}

/**
 * Kun disse egenskapene kan noen gang bli bekreftet. Alt annet forkastes.
 *
 * VIKTIG: allowlisten brukes IKKE av claim. Se `UNVERIFIED_CAPABILITIES`.
 */
export const CAPABILITY_ALLOWLIST = [
  "background_execution",
  "scheduled_runs",
  "email_forward_or_send",
] as const;

/**
 * Filtrerer et capability-objekt mot allowlisten. Beregnet på en senere,
 * serverkontrollert verifisering/challenge — ikke på klientpåstander.
 */
export function pickAllowedCapabilities(raw: unknown): AiCapabilities {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: AiCapabilities = {};
  for (const key of CAPABILITY_ALLOWLIST) {
    if (source[key] === true) out[key] = true;
    else if (source[key] === false) out[key] = false;
  }
  return out;
}

/**
 * Capabilities ved claim.
 *
 * Engangskoden beviser at brukeren har gitt samtykke og hatt tilgang til
 * koden. Den beviser INGENTING om hva plattformen faktisk kan gjøre. En
 * uautentisert klient kan påstå hva som helst, så claim setter alltid
 * tomme (ubekreftede) capabilities. Forbindelsen blir aktiv, men ingen
 * egenskap er bekreftet.
 *
 * Oppgradering skjer først i en senere fase, gjennom en serverkontrollert
 * verifisering/challenge per egenskap (se
 * docs/operations/ai-integrations-mcp-oauth-spec.md). Først da kan
 * `pickAllowedCapabilities` brukes på et serververifisert resultat.
 */
export const UNVERIFIED_CAPABILITIES: AiCapabilities = Object.freeze({});

/** Capabilities som lagres ved claim. Alltid tomt, uansett hva klienten sender. */
export function claimCapabilities(_clientClaimed?: unknown): AiCapabilities {
  return { ...UNVERIFIED_CAPABILITIES };
}

/** Statuser som gir en agent lov til å bruke API-et. */
export const AGENT_ALLOWED_STATUSES = ["active", "degraded"] as const;

export function isAgentUsableStatus(status: string | null | undefined): boolean {
  return (AGENT_ALLOWED_STATUSES as readonly string[]).includes(status ?? "");
}

/** Arbeidsflyter en agent kan be om. Speiler automation_runs-skjemaet. */
export const AGENT_WORKFLOW_KINDS = ["job_import", "career_log", "linkedin_ready"] as const;
export type AgentWorkflowKind = (typeof AGENT_WORKFLOW_KINDS)[number];

export function isAgentWorkflowKind(value: unknown): value is AgentWorkflowKind {
  return typeof value === "string" && (AGENT_WORKFLOW_KINDS as readonly string[]).includes(value);
}

/** Hvilken automatiseringspreferanse som styrer hver arbeidsflyt. */
export const WORKFLOW_PREFERENCE_KEY: Record<AgentWorkflowKind, string> = {
  job_import: "job_email_import_enabled",
  career_log: "career_email_suggestions_enabled",
  linkedin_ready: "linkedin_ready_detection_enabled",
};
