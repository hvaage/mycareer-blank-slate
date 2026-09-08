// ============================================================
// Leverandørnøytral AI-integrasjon — ren kontraktsmodul.
//
// Ingen I/O her. Modulen eies av både server og klient, og
// definerer hvilke leverandører som finnes, hvilke valg brukeren
// kan ta, og hvordan driftsformen (effective_mode) UTLEDES av
// bekreftede capabilities. Brukeren velger aldri driftsform selv.
// ============================================================

export const AI_PROVIDERS = ["grok", "claude", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Visningsnavn. Rekkefølgen er alfabetisk på visningsnavn — ingen anbefaling. */
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude",
  openai: "ChatGPT / Codex",
  gemini: "Gemini",
  grok: "Grok",
};

/** Fire likestilte valg, vist i fast nøytral rekkefølge. */
export const AI_PROVIDER_ORDER: readonly AiProvider[] = ["claude", "openai", "gemini", "grok"];

export const AI_PLAN_TIERS = ["free", "paid", "unknown"] as const;
export type AiPlanTier = (typeof AI_PLAN_TIERS)[number];

export const AI_PLAN_LABELS: Record<AiPlanTier, string> = {
  free: "Gratis",
  paid: "Betalt",
  unknown: "Usikker",
};

export const AI_EFFECTIVE_MODES = ["guided", "agent", "email_rule", "hybrid"] as const;
export type AiEffectiveMode = (typeof AI_EFFECTIVE_MODES)[number];

export const AI_STATUSES = ["draft", "connecting", "active", "degraded", "disconnected"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/**
 * Bekreftede egenskaper. Settes kun av verifisering mot leverandøren,
 * aldri av brukerens egen beskrivelse av abonnementet.
 */
export type AiCapabilities = {
  background_execution?: boolean;
  scheduled_runs?: boolean;
  email_forward_or_send?: boolean;
};

/**
 * Utleder driftsform av bekreftede capabilities.
 *   bakgrunn + planlagt + e-post  -> hybrid
 *   bakgrunn + planlagt           -> agent
 *   kun e-post                    -> email_rule
 *   ellers                        -> guided
 */
export function deriveEffectiveMode(
  capabilities: AiCapabilities | null | undefined,
): AiEffectiveMode {
  const c = capabilities ?? {};
  const background = c.background_execution === true;
  const scheduled = c.scheduled_runs === true;
  const email = c.email_forward_or_send === true;

  if (background && scheduled && email) return "hybrid";
  if (background && scheduled) return "agent";
  if (email && !background && !scheduled) return "email_rule";
  return "guided";
}

/** Forklaring i dagligtale — ingen tekniske ord mot bruker. */
export const EFFECTIVE_MODE_TEXT: Record<AiEffectiveMode, { title: string; body: string }> = {
  guided: {
    title: "Du starter oppgavene selv",
    body: "Assistenten din kan ikke kjøre noe i bakgrunnen ennå. Du starter oppgavene når det passer deg, og Karrierenmin tar seg av mottak, analyse, lagring og varsler.",
  },
  email_rule: {
    title: "E-post går automatisk, resten starter du selv",
    body: "Assistenten kan sende og videresende e-post. Jobbvarsler kommer inn av seg selv, mens andre oppgaver starter du når det passer deg.",
  },
  agent: {
    title: "Faste oppgaver kjører av seg selv",
    body: "Assistenten kan jobbe i bakgrunnen på faste tidspunkter. Du får forslag til gjennomgang i stedet for å måtte starte alt manuelt.",
  },
  hybrid: {
    title: "Både e-post og faste oppgaver kjører av seg selv",
    body: "Assistenten kan både håndtere e-post og jobbe i bakgrunnen på faste tidspunkter. Du godkjenner fortsatt alt som skal inn i karriereloggen.",
  },
};

/** Brukerens egne e-post- og LinkedIn-valg, med standardverdiene fra produktkravet. */
export type AutomationChoices = {
  /** Importer jobbvarsler — på som standard. */
  job_email_import_enabled: boolean;
  /** Foreslå oppføringer til karriereloggen fra e-post — av som standard. */
  career_email_suggestions_enabled: boolean;
  /** Oppdag når LinkedIn-eksporten er klar — følger LinkedIn-valget. */
  linkedin_ready_detection_enabled: boolean;
  /** Offisiell LinkedIn ZIP-import — forhåndsvalgt. */
  linkedin_export_import_enabled: boolean;
};

export const DEFAULT_AUTOMATION_CHOICES: AutomationChoices = {
  job_email_import_enabled: true,
  career_email_suggestions_enabled: false,
  linkedin_ready_detection_enabled: true,
  linkedin_export_import_enabled: true,
};

export type SaveIntegrationInput = {
  provider: AiProvider;
  plan_tier: AiPlanTier;
  automation: AutomationChoices;
};

export type ValidationResult =
  | { ok: true; value: SaveIntegrationInput }
  | { ok: false; error: string };

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = source[key];
  if (raw === undefined || raw === null) return fallback;
  return raw === true;
}

/**
 * Validerer klientens forespørsel. user_id fra forespørselen blir alltid
 * ignorert — bruker-id hentes utelukkende fra verifisert pålogging.
 */
export function parseSaveIntegrationInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Ugyldig forespørsel." };
  }
  const input = body as Record<string, unknown>;

  const provider = input["provider"];
  if (typeof provider !== "string" || !(AI_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, error: "Velg en gyldig assistent." };
  }

  const planTier = input["plan_tier"] ?? "unknown";
  if (typeof planTier !== "string" || !(AI_PLAN_TIERS as readonly string[]).includes(planTier)) {
    return { ok: false, error: "Velg et gyldig abonnementsnivå." };
  }

  const automationRaw = input["automation"];
  const automation =
    typeof automationRaw === "object" && automationRaw !== null && !Array.isArray(automationRaw)
      ? (automationRaw as Record<string, unknown>)
      : {};

  const linkedinImport = readBoolean(
    automation,
    "linkedin_export_import_enabled",
    DEFAULT_AUTOMATION_CHOICES.linkedin_export_import_enabled,
  );

  return {
    ok: true,
    value: {
      provider: provider as AiProvider,
      plan_tier: planTier as AiPlanTier,
      automation: {
        job_email_import_enabled: readBoolean(
          automation,
          "job_email_import_enabled",
          DEFAULT_AUTOMATION_CHOICES.job_email_import_enabled,
        ),
        career_email_suggestions_enabled: readBoolean(
          automation,
          "career_email_suggestions_enabled",
          DEFAULT_AUTOMATION_CHOICES.career_email_suggestions_enabled,
        ),
        // «Oppdag når eksporten er klar» gir bare mening når LinkedIn-import er valgt.
        linkedin_ready_detection_enabled:
          linkedinImport &&
          readBoolean(
            automation,
            "linkedin_ready_detection_enabled",
            DEFAULT_AUTOMATION_CHOICES.linkedin_ready_detection_enabled,
          ),
        linkedin_export_import_enabled: linkedinImport,
      },
    },
  };
}

/** Engangskode: 32 tegn fra et forvekslingsfritt alfabet, gruppert i blokker på 4. */
export const SETUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SETUP_CODE_LENGTH = 32;
export const SETUP_CODE_TTL_MINUTES = 15;

export function formatSetupCode(raw: string): string {
  return (raw.match(/.{1,4}/g) ?? []).join("-");
}

export function isValidSetupCodeFormat(code: string): boolean {
  const plain = code.replace(/-/g, "");
  if (plain.length !== SETUP_CODE_LENGTH) return false;
  return plain.split("").every((ch) => SETUP_CODE_ALPHABET.includes(ch));
}

export function setupCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SETUP_CODE_TTL_MINUTES * 60_000);
}

export function isSetupCodeExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return !(exp.getTime() > now.getTime());
}

/** E-postleverandører vi viser i oppsettet. Kalender vises aldri som datakilde. */
export const EMAIL_PROVIDER_OPTIONS = [
  { value: "gmail", label: "Gmail" },
  { value: "microsoft", label: "Outlook / Microsoft 365" },
  { value: "apple", label: "Apple / iCloud" },
  { value: "other", label: "Annen e-postleverandør" },
  { value: "multiple", label: "Flere kontoer" },
] as const;

export type EmailProviderChoice = (typeof EMAIL_PROVIDER_OPTIONS)[number]["value"];
