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

