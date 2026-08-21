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
