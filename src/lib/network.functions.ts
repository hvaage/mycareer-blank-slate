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

const manualFieldsSchema = z.object({
  contactId: z.string().uuid(),
  displayName: z.string().max(300).nullable().optional(),
  headline: z.string().max(500).nullable().optional(),
});

/**
 * Manuelle kontaktfelt. Brukeridentitet tas kun fra verifisert serversesjon;
 * tomt felt tilbakestiller visningen til siste LinkedIn-observasjon.
 * Rå kontaktdata logges aldri.
 */
export const updateContactManualFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => manualFieldsSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "network_update_contact_manual_fields" as never,
      {
        p_user_id: context.userId,
        p_contact_id: data.contactId,
        p_display_name: data.displayName ?? null,
        p_headline: data.headline ?? null,
      } as never,
    );
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
