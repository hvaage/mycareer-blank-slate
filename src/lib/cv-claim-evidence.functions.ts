// Evidensgjennomgang av påstander i et CV-utkast.
//
// Brukerbekreftelse er en egen, sporbar handling: den lagres med teksten den
// gjelder for. Endres teksten, faller bekreftelsen bort automatisk (database-
// trigger), og påstanden blokkerer godkjenning på nytt.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  claimReviewActionsFor,
  evidenceStatusFor,
  isApprovalBlocking,
  summarizeEvidence,
  type ClaimEvidence,
  type ClaimVerification,
  type DocumentEvidenceReport,
} from "@/lib/cv-skills-contract";

type AttestationRow = {
  claim_id: string;
  attested_at: string;
  attested_claim_text: string;
  attested_claim_hash: string;
  note: string | null;
  external_source_name: string | null;
  external_source_year: number | null;
  external_document_available: boolean;
};

async function buildReport(
  supabase: any,
  documentId: string,
): Promise<DocumentEvidenceReport> {
  const { data: claimRows, error } = await supabase
    .from("cv_document_claims")
    .select("claim_id, block_id, claim_type, value, supporting_atom_ids, verification")
    .eq("document_id", documentId);
  if (error) throw new Error("Kunne ikke hente påstandene.");

  const { data: attRows } = await supabase
    .from("cv_claim_attestations")
    .select(
      "claim_id, attested_at, attested_claim_text, attested_claim_hash, note, external_source_name, external_source_year, external_document_available",
    )
    .eq("document_id", documentId)
    .is("withdrawn_at", null)
    .is("invalidated_at", null);

  const byClaim = new Map<string, AttestationRow>(
    ((attRows ?? []) as AttestationRow[]).map((r) => [r.claim_id, r]),
  );

  const claims: ClaimEvidence[] = ((claimRows ?? []) as any[]).map((c) => {
    const att = byClaim.get(c.claim_id) ?? null;
    const valid = att !== null && attestationSurvivesRewrite(att.attested_claim_text, String(c.value));
    const evidenceStatus = evidenceStatusFor(c.verification as ClaimVerification, valid);
    return {
      claimId: c.claim_id,
      blockId: c.block_id,
      type: c.claim_type,
      value: c.value,
      verification: c.verification,
      evidenceStatus,
      approvalBlocking: isApprovalBlocking(evidenceStatus),
      supportingAtomIds: c.supporting_atom_ids ?? [],
      availableActions: claimReviewActionsFor(evidenceStatus),
      unsupportedElements:
        evidenceStatus === "documented"
          ? []
          : classifyUnsupportedElements(String(c.value), c.verification as ClaimVerification),
      contradiction:
        c.verification === "contradicted"
          ? {
              text: String(c.value),
              conflictingAtomIds: c.supporting_atom_ids ?? [],
              reason: "Grunnlaget ditt sier noe annet enn denne formuleringen.",
            }
          : null,
      userAttestation: att
        ? {
            claimId: att.claim_id,
            attestedAt: att.attested_at,
            attestedClaimText: att.attested_claim_text,
            note: att.note,
            externalSourceName: att.external_source_name,
            externalSourceYear: att.external_source_year,
            externalDocumentAvailable: att.external_document_available,
            valid,
            withdrawnAt: att.withdrawn_at ?? null,
            invalidatedAt: att.invalidated_at ?? null,
            invalidatedReason: att.invalidated_reason ?? null,
            provenance: {
              channel: "user_review_ui" as const,
              actor: "user" as const,
              verificationAtAttestation:
                (att.verification_at_attestation as ClaimVerification | null) ?? null,
              claimVersion: att.attested_claim_version ?? 1,
              documentOutputHash: att.document_output_hash ?? null,
            },
            internalNote: USER_ATTESTED_INTERNAL_NOTE,
          }
        : null,
    };
  });


  return summarizeEvidence(documentId, claims);
}

export const getClaimEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => buildReport((context as any).supabase, data.documentId));

export const attestClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        claimId: z.string().min(1).max(64),
        note: z.string().max(2000).nullable().optional(),
        externalSourceName: z.string().max(200).nullable().optional(),
        externalSourceYear: z.number().int().min(1900).max(2100).nullable().optional(),
        externalDocumentAvailable: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = (context as any).supabase;
    const userId = (context as any).userId as string;

    // Bekreftelsen gjelder teksten slik den står nå — aldri en tidligere versjon.
    const { data: claim, error } = await supabase
      .from("cv_document_claims")
      .select("claim_id, value, verification")
      .eq("document_id", data.documentId)
      .eq("claim_id", data.claimId)
      .maybeSingle();
    if (error || !claim) throw new Error("Fant ikke påstanden.");
    if (claim.verification === "contradicted") {
      throw new Error("Denne opplysningen strider mot grunnlaget og kan ikke bekreftes.");
    }

    const { error: insertError } = await supabase.from("cv_claim_attestations").insert({
      document_id: data.documentId,
      claim_id: data.claimId,
      attested_by_user_id: userId,
      attested_claim_text: claim.value,
      attested_claim_hash: "",
      note: data.note ?? null,
      external_source_name: data.externalSourceName ?? null,
      external_source_year: data.externalSourceYear ?? null,
      external_document_available: data.externalDocumentAvailable ?? false,
    });
    if (insertError) throw new Error("Kunne ikke lagre bekreftelsen.");

    return buildReport(supabase, data.documentId);
  });

export const withdrawClaimAttestation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        claimId: z.string().min(1).max(64),
        reason: z.string().max(500).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = (context as any).supabase;
    const { error } = await supabase
      .from("cv_claim_attestations")
      .update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: data.reason ?? null })
      .eq("document_id", data.documentId)
      .eq("claim_id", data.claimId)
      .is("withdrawn_at", null)
      .is("invalidated_at", null);
    if (error) throw new Error("Kunne ikke trekke bekreftelsen.");
    return buildReport(supabase, data.documentId);
  });
