// ============================================================
// Nettverk og muligheter — kanoniske skrivehandlinger.
//
// All skriving går gjennom SECURITY DEFINER-RPC-er som verken anon
// eller authenticated har execute-rett på. Serverfunksjonen validerer
// innlogget bruker først og sender brukerens id videre; RPC-en
// validerer eierskap på nytt inne i databasen.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const relationshipSchema = z.object({
  companyId: z.string().uuid(),
  companyName: z.string().max(300).nullable().optional(),
  status: z
    .enum(["following", "target", "active_dialogue", "applied", "former_employer", "paused"])
    .nullable()
    .optional(),
  priority: z.enum(["low", "normal", "high"]).nullable().optional(),
});

export const setCompanyRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => relationshipSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_set_company_relationship" as never,
      {
        p_user_id: context.userId,
        p_company_id: data.companyId,
        p_status: data.status ?? null,
        p_priority: data.priority ?? null,
        p_company_name: data.companyName ?? null,
      } as never,
    );
    const payload = (result ?? null) as {
      ok?: boolean;
      error_code?: string;
      status?: string | null;
      priority?: string | null;
    } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null, status: payload.status ?? null, priority: payload.priority ?? null };
  });

const promoteSchema = z.object({
  batchId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(5000),
});

/**
 * Promoterer kun personkontakter brukeren eksplisitt har valgt, og kun
 * fra en frossen batch med status «ready». Selskapsobservasjoner,
 * arrangementer, hashtag-signaler og invitasjoner avvises i databasen.
 */
export const promoteNetworkBatchContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => promoteSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_promote_batch_person_contacts" as never,
      {
        p_user_id: context.userId,
        p_batch_id: data.batchId,
        p_item_ids: data.itemIds,
      } as never,
    );
    const payload = (result ?? null) as {
      ok?: boolean;
      error_code?: string;
      created_count?: number;
      skipped_count?: number;
      requested_count?: number;
    } | null;
    if (error || !payload?.ok) {
      return {
        ok: false,
        errorCode: payload?.error_code ?? "promotion_write_failed",
        createdCount: 0,
        skippedCount: 0,
      };
    }
    return {
      ok: true,
      errorCode: null,
      createdCount: payload.created_count ?? 0,
      skippedCount: payload.skipped_count ?? 0,
    };
  });

const RELATION_STATUS = ["ukjent", "varm", "aktiv", "referanse", "ikke_aktuell"] as const;

const manualFieldsSchema = z.object({
  contactId: z.string().uuid(),
  displayName: z.string().max(300).nullable().optional(),
  headline: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  relationStatus: z.enum(RELATION_STATUS).nullable().optional(),
});

/**
 * Manuelle kontaktfelt, notater og brukerens relasjon til personen.
 * Kallet gjøres med brukerens verifiserte JWT (`context.supabase`), aldri med
 * service_role; RPC-en henter selv identitet fra `auth.uid()`.
 * Tomt felt tilbakestiller visningen til siste LinkedIn-observasjon.
 */
export const updateContactManualFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => manualFieldsSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "network_update_contact_manual_profile" as never,
      {
        p_contact_id: data.contactId,
        p_display_name: data.displayName ?? null,
        p_headline: data.headline ?? null,
        p_notes: data.notes ?? null,
        p_relation_status: data.relationStatus ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });

const contactPointsSchema = z.object({
  contactId: z.string().uuid(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
});

/**
 * Kontaktpunkter er kun brukerens egne, eksplisitte verdier.
 * LinkedIn-import og annonseobservasjoner skriver aldri hit.
 */
export const updateContactContactPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactPointsSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "network_update_contact_contact_points" as never,
      {
        p_contact_id: data.contactId,
        p_email: data.email ?? null,
        p_phone: data.phone ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });

const recommendationLinkSchema = z.object({
  recommendationId: z.string().uuid(),
  contactId: z.string().uuid().nullable().optional(),
});

/**
 * Kobler en mottatt LinkedIn-anbefaling til en kontakt — kun ved eksplisitt
 * brukerhandling. Navnelikhet, selskap eller rolle er aldri grunnlag.
 * `contactId = null` kobler fra og bevarer anbefalingen.
 */
export const linkRecommendationToContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recommendationLinkSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = data.contactId
      ? await context.supabase.rpc("network_link_recommendation_contact" as never, {
          p_recommendation_id: data.recommendationId,
          p_contact_id: data.contactId,
        } as never)
      : await context.supabase.rpc("network_unlink_recommendation_contact" as never, {
          p_recommendation_id: data.recommendationId,
        } as never);
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });


const contactRelationSchema = z.object({
  contactId: z.string().uuid(),
  companyName: z.string().max(300).nullable().optional(),
  relationKind: z
    .enum(["current_employer", "past_employer", "affiliation", "unknown"])
    .nullable()
    .optional(),
  relationStatus: z.string().max(120).nullable().optional(),
  validFrom: z.string().date().nullable().optional(),
  validTo: z.string().date().nullable().optional(),
});

/**
 * Manuell eller korrigert selskapstilknytning. LinkedIn-observert tilknytning
 * beholdes som egen historikkrad; kun én relasjon per kontakt er aktiv.
 */
export const setContactCompanyRelation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactRelationSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_set_contact_company_relation" as never,
      {
        p_user_id: context.userId,
        p_contact_id: data.contactId,
        p_company_name: data.companyName ?? null,
        p_relation_kind: data.relationKind ?? "unknown",
        p_relation_status: data.relationStatus ?? null,
        p_valid_from: data.validFrom ?? null,
        p_valid_to: data.validTo ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });


const activitySchema = z.object({
  activityId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  priority: z.enum(["høy", "middels", "lav"]).nullable().optional(),
  activityType: z
    .enum(["oppfolging", "moete", "samtale", "e_post", "soknad", "intervju", "annet"])
    .nullable()
    .optional(),
  status: z.enum(["planlagt", "pagaar", "utfort", "avlyst"]).nullable().optional(),
  resultNote: z.string().max(4000).nullable().optional(),
  activityScope: z.enum(["context", "personal"]).default("context"),
  contactId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  applicationId: z.string().uuid().nullable().optional(),
});

/**
 * Kanonisk skrivehandling for aktiviteter. Klienten sender aldri `user_id`,
 * og en kontekstaktivitet må ha minst én konkret kobling.
 */
export const upsertActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => activitySchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_upsert_activity" as never,
      {
        p_user_id: context.userId,
        p_activity_id: data.activityId ?? null,
        p_title: data.title,
        p_description: data.description ?? null,
        p_due_date: data.dueDate ?? null,
        p_priority: data.priority ?? null,
        p_activity_type: data.activityType ?? null,
        p_status: data.status ?? null,
        p_result_note: data.resultNote ?? null,
        p_activity_scope: data.activityScope,
        p_contact_id: data.contactId ?? null,
        p_company_id: data.companyId ?? null,
        p_opportunity_id: data.opportunityId ?? null,
        p_application_id: data.applicationId ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string; activity_id?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed", activityId: null };
    }
    return { ok: true, errorCode: null, activityId: payload.activity_id ?? null };
  });

const completeSchema = z.object({
  activityId: z.string().uuid(),
  status: z.enum(["planlagt", "pagaar", "utfort", "avlyst"]).default("utfort"),
  resultNote: z.string().max(4000).nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

export const completeActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => completeSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_complete_activity" as never,
      {
        p_user_id: context.userId,
        p_activity_id: data.activityId,
        p_status: data.status,
        p_result_note: data.resultNote ?? null,
        p_completed_at: data.completedAt ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string; status?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed", status: null };
    }
    return { ok: true, errorCode: null, status: payload.status ?? null };
  });

const hideCompanySchema = z.object({
  companyKey: z.string().min(1).max(400),
  companyId: z.string().uuid().nullable().optional(),
  companyName: z.string().max(300).nullable().optional(),
  reason: z.string().max(300).nullable().optional(),
});

/** Skjuler et selskap i brukerens eget nettverksregister. Kildedata røres ikke. */
export const hideCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => hideCompanySchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_hide_company" as never,
      {
        p_user_id: context.userId,
        p_company_key: data.companyKey,
        p_company_id: data.companyId ?? null,
        p_company_name: data.companyName ?? null,
        p_reason: data.reason ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });

export const unhideCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyKey: z.string().min(1).max(400) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_unhide_company" as never,
      { p_user_id: context.userId, p_company_key: data.companyKey } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });

// ============================================================
// Fase 5C — dokument/mulighet, annonsekontakt og søknadsstart.
// Bruker-id kommer alltid fra den verifiserte sesjonen, aldri fra klienten.
// ============================================================

const documentLinkSchema = z.object({
  documentId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
});

/** Kobler eller frikobler et dokument til en mulighet. Databasen er siste sperre. */
export const linkDocumentToOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => documentLinkSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_link_document_opportunity" as never,
      {
        p_user_id: context.userId,
        p_document_id: data.documentId,
        p_opportunity_id: data.opportunityId,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed" };
    }
    return { ok: true, errorCode: null };
  });

const opportunityIdSchema = z.object({ opportunityId: z.string().uuid() });

/**
 * Kontaktpersoner slik de faktisk står i den lagrede annonsekilden.
 * Klienten får en serverutledet, stabil referanse — aldri motsatt vei.
 */
export const listPostingContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => opportunityIdSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_posting_contacts_for_opportunity" as never,
      { p_user_id: context.userId, p_opportunity_id: data.opportunityId } as never,
    );
    const payload = (result ?? null) as {
      ok?: boolean;
      error_code?: string;
      contacts?: Array<Record<string, string | null>>;
    } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "read_failed", contacts: [] };
    }
    return { ok: true, errorCode: null, contacts: payload.contacts ?? [] };
  });

const postingContactSchema = z.object({
  opportunityId: z.string().uuid(),
  sourceContactRef: z.string().min(8).max(200),
  existingContactId: z.string().uuid().nullable().optional(),
});

/**
 * Oppretter eller kobler annonsekontakt. Navn, rolle, e-post og telefon leses
 * av databasen fra annonsekilden; klientens verdier brukes aldri som kilde.
 */
export const linkPostingContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => postingContactSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_link_posting_contact" as never,
      {
        p_user_id: context.userId,
        p_opportunity_id: data.opportunityId,
        p_source_contact_ref: data.sourceContactRef,
        p_existing_contact_id: data.existingContactId ?? null,
      } as never,
    );
    const payload = (result ?? null) as { ok?: boolean; error_code?: string; contact_id?: string } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed", contactId: null };
    }
    return { ok: true, errorCode: null, contactId: payload.contact_id ?? null };
  });

const startApplicationSchema = z.object({ canonicalOpportunityId: z.string().uuid() });

/** Idempotent søknadsstart: samme annonse gir aldri to muligheter for samme bruker. */
export const startApplicationFromPosting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startApplicationSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_start_application_from_posting" as never,
      { p_user_id: context.userId, p_canonical_opportunity_id: data.canonicalOpportunityId } as never,
    );
    const payload = (result ?? null) as {
      ok?: boolean;
      error_code?: string;
      opportunity_id?: string;
      created?: boolean;
    } | null;
    if (error || !payload?.ok) {
      return { ok: false, errorCode: payload?.error_code ?? "write_failed", opportunityId: null, created: false };
    }
    return {
      ok: true,
      errorCode: null,
      opportunityId: payload.opportunity_id ?? null,
      created: !!payload.created,
    };
  });
