// ============================================================
// Fase 4 — promoteringsport (klientside-kontrakt).
//
// Regler:
//  * Kun create_new, link_to_existing og use_linkedin_value går gjennom
//    promoterings-RPC-ene. keep_existing og manual_edit_required går gjennom
//    beslutningslaget (linkedin_reconciliation_decide) og gir aldri en
//    promoteringshendelse med status=promoted.
//  * Produktendring, proveniens, hendelse og status=promoted skrives i én
//    atomisk transaksjon i databasen. Feiler noe, rulles alt tilbake.
//  * Ved feil skrives en separat, append-only feilhendelse gjennom
//    linkedin_promotion_record_failure med feilkode og sanitert sammendrag.
//    Rå LinkedIn-innhold og rå databasefeil sendes aldri med.
//  * Retrybare feil lar forslaget stå som approved_for_promotion.
//    Ikke-retrybare valideringsfeil setter forslaget til promotion_failed,
//    og brukeren reåpner det via linkedin_promotion_reopen (beslutningslaget).
// ============================================================
import { supabase } from "@/lib/supabase";

export const PROMOTION_RESOLUTIONS = ["create_new", "link_to_existing", "use_linkedin_value"] as const;
export type PromotionResolution = (typeof PROMOTION_RESOLUTIONS)[number];

/** Resolutions som aldri er promotering — de går via beslutningslaget. */
export const DECISION_ONLY_RESOLUTIONS = ["keep_existing", "manual_edit_required"] as const;
export type DecisionOnlyResolution = (typeof DECISION_ONLY_RESOLUTIONS)[number];

export type PromotionAction =
  | "promote_profile_field"
  | "promote_career_record"
  | "promote_qualification"
  | "promote_skill_or_signal"
  | "promote_recommendation"
  | "promote_network_contact"
  | "promote_job_preference"
  | "promote_saved_job";

const RPC_BY_ACTION: Record<PromotionAction, string> = {
  promote_profile_field: "linkedin_promote_profile_field",
  promote_career_record: "linkedin_promote_career_record",
  promote_qualification: "linkedin_promote_qualification",
  promote_skill_or_signal: "linkedin_promote_skill_or_signal",
  promote_recommendation: "linkedin_promote_recommendation",
  promote_network_contact: "linkedin_promote_network_contact",
  promote_job_preference: "linkedin_promote_job_preference",
  promote_saved_job: "linkedin_promote_saved_job",
};

/**
 * Feil som betyr «brukeren må velge noe annet», ikke «forslaget er ugyldig».
 * Disse er retrybare: forslaget beholder approved_for_promotion.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "promotion_write_failed",
  "target_not_empty",
  "no_change_needed",
  "missing_existing_target",
  "existing_target_not_found",
]);

/** Feil der ingen feilhendelse gir mening (ingen promoteringsforsøk fant sted). */
const NO_EVENT_ERROR_CODES = new Set([
  "not_authenticated",
  "proposal_not_found",
  "already_promoted",
  "not_approved_for_promotion",
]);

/** Korte, kontrollerte forklaringer. Aldri kildeinnhold, aldri databasefeil. */
const ERROR_SUMMARIES: Record<string, string> = {
  promotion_write_failed: "Skrivingen feilet og ble rullet tilbake. Ingen data ble endret.",
  target_not_empty: "Feltet er allerede utfylt. Velg eksplisitt om LinkedIn-verdien skal brukes.",
  no_change_needed: "LinkedIn-verdien er lik den du allerede har.",
  missing_existing_target: "Ingen eksisterende oppføring var valgt for kobling.",
  existing_target_not_found: "Den valgte eksisterende oppføringen finnes ikke lenger.",
  invalid_resolution: "Valgt handling er ikke en gyldig promotering.",
  invalid_resolution_for_domain: "Valgt handling er ikke gyldig for dette området.",
  resolution_requires_decision_layer: "Handlingen skal registreres som en beslutning, ikke som promotering.",
  field_not_promotable: "Feltet kan ikke promoteres.",
  unsupported_qualification_type: "Kvalifikasjonstypen støttes ikke.",
  empty_source_value: "Kildegrunnlaget mangler verdi.",
  missing_identity: "Kontakten mangler en LinkedIn-identitet.",
  source_class_blocked: "Kildeklassen tillater ikke promotering.",
  source_minimized: "Kildegrunnlaget er slettet eller minimert.",
  import_inactive: "Importen er slettet eller avbrutt.",
  skipped_no_selected_purpose: "Formålet dette forslaget hører til, er ikke valgt.",
  wrong_promotion_port: "Forslaget hører til et annet promoteringsområde.",
};

export const PROMOTION_ERROR_MESSAGES = ERROR_SUMMARIES;

export type PromotionResult =
  | { ok: true; promotionEventId: string; status: "promoted"; raw: Record<string, unknown> }
  | {
      ok: false;
      errorCode: string;
      retryable: boolean;
      message: string;
      proposalStatus: "approved_for_promotion" | "promotion_failed" | "unchanged";
      conflict?: Record<string, unknown>;
    };

type RpcArgs = Record<string, unknown>;

/**
 * Kjører én promotering og sørger for at et feilet forsøk blir dokumentert
 * i en egen, append-only feilhendelse etter at produkttransaksjonen er rullet
 * tilbake.
 */
export async function promoteProposal(input: {
  proposalId: string;
  action: PromotionAction;
  resolution: PromotionResolution;
  field?: string;
  existingAtomId?: string | null;
}): Promise<PromotionResult> {
  const args: RpcArgs = {
    p_proposal_id: input.proposalId,
    p_resolution: input.resolution,
  };
  if (input.field) args["p_field"] = input.field;
  if (input.existingAtomId) args["p_existing_atom_id"] = input.existingAtomId;

  let payload: Record<string, unknown> | null = null;
  let transportFailed = false;

  const { data, error } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    RPC_BY_ACTION[input.action] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args as any,
  );

  if (error) {
    transportFailed = true;
  } else {
    payload = (data ?? null) as Record<string, unknown> | null;
  }

  if (!transportFailed && payload && payload["ok"] === true) {
    return {
      ok: true,
      promotionEventId: String(payload["promotion_event_id"] ?? ""),
      status: "promoted",
      raw: payload,
    };
  }

  const errorCode = transportFailed
    ? "promotion_write_failed"
    : String(payload?.["error_code"] ?? "promotion_write_failed");
  const retryable = transportFailed
    ? true
    : typeof payload?.["retryable"] === "boolean"
      ? Boolean(payload["retryable"])
      : RETRYABLE_ERROR_CODES.has(errorCode);
  const message = ERROR_SUMMARIES[errorCode] ?? "Promoteringen ble ikke gjennomført.";

  let proposalStatus: "approved_for_promotion" | "promotion_failed" | "unchanged" = "unchanged";

  if (!NO_EVENT_ERROR_CODES.has(errorCode)) {
    const { data: failureData } = await supabase.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "linkedin_promotion_record_failure" as any,
      {
        p_proposal_id: input.proposalId,
        p_action: input.action,
        p_error_code: errorCode,
        p_retryable: retryable,
        p_error_summary: message,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    const failure = failureData as unknown as { ok?: boolean; proposal_status?: string } | null;
    if (failure?.ok) {
      proposalStatus =
        failure.proposal_status === "promotion_failed" ? "promotion_failed" : "approved_for_promotion";
    }
  }

  const conflict = payload?.["conflict"] as Record<string, unknown> | undefined;
  return conflict
    ? { ok: false, errorCode, retryable, message, proposalStatus, conflict }
    : { ok: false, errorCode, retryable, message, proposalStatus };
}

/** Reåpner et ikke-retrybart feilet forslag gjennom beslutningslaget. */
export async function reopenFailedProposal(proposalId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "linkedin_promotion_reopen" as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { p_proposal_id: proposalId } as any,
  );
  if (error) return false;
  return Boolean((data as unknown as { ok?: boolean } | null)?.ok);
}

/** «Behold eksisterende» er en beslutning, aldri en promotering. */
export async function keepExisting(proposalId: string): Promise<boolean> {
  return decide(proposalId, "dismiss", "keep_existing");
}

/** «Må redigeres manuelt» er en beslutning, aldri en promotering. */
export async function requestManualEdit(proposalId: string): Promise<boolean> {
  return decide(proposalId, "request_manual_edit", null);
}

async function decide(proposalId: string, decision: string, reasonCode: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "linkedin_reconciliation_decide" as any,
    {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_reason_code: reasonCode,
      p_note: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  );
  if (error) return false;
  return Boolean((data as unknown as { ok?: boolean } | null)?.ok);
}

/** Kvalifikasjonstyper går alltid til kvalifikasjonsporten, uansett kildedomene. */
const QUALIFICATION_ATOM_TYPES = new Set(["education", "certification", "language", "course"]);
const SKILL_ATOM_TYPES = new Set(["skill", "endorsement"]);

/** Hvilken promoteringsport hører et forslag hjemme i? */
export function promotionActionForDomain(
  domain: string,
  proposalKind: string,
  atomType?: string | null,
): PromotionAction | null {
  if (proposalKind === "not_actionable_in_phase_3") return null;

  const type = (atomType ?? "").trim().toLowerCase();
  if (type && QUALIFICATION_ATOM_TYPES.has(type)) return "promote_qualification";
  if (type && SKILL_ATOM_TYPES.has(type) && domain !== "network") return "promote_skill_or_signal";

  switch (domain) {
    case "profile":
      return "promote_profile_field";
    case "career":
      return "promote_career_record";
    case "learning":
      return "promote_qualification";
    case "endorsements":
      return "promote_skill_or_signal";
    case "recommendations":
      return "promote_recommendation";
    case "network":
      return "promote_network_contact";
    case "jobs":
      return "promote_saved_job";
    default:
      return null; // content: not_actionable_in_phase_4
  }
}


export const PROMOTION_BUTTON_LABELS: Record<PromotionAction, string> = {
  promote_profile_field: "Legg til i min profil",
  promote_career_record: "Legg til i karriereoversikt",
  promote_qualification: "Legg til som kvalifikasjon",
  promote_skill_or_signal: "Legg til som kompetanse",
  promote_recommendation: "Legg til som LinkedIn-anbefaling",
  promote_network_contact: "Legg til i nettverket",
  promote_job_preference: "Legg til som jobbønske",
  promote_saved_job: "Legg til som jobbtips",
};
