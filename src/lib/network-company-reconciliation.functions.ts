// ============================================================
// Fase 5H — kontrollert selskapsidentitetsavstemming.
//
// All skriving går gjennom kanoniske SECURITY DEFINER-RPC-er som scoper
// på auth.uid(). Klienten sender aldri user_id, og det globale laget
// (source_company_resolutions) leses aldri direkte fra nettleseren.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ORGNR_RE = /^\d{9}$/;

const scanSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

export const scanCompanyReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scanSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "network_company_reconciliation_scan" as never,
      { p_limit: data.limit ?? 300 } as never,
    );
    if (error) {
      return { ok: false as const, errorCode: "scan_failed", processed: 0, remaining: 0 };
    }
    const payload = (result ?? {}) as { processed?: number; remaining?: number };
    return {
      ok: true as const,
      errorCode: null,
      processed: payload.processed ?? 0,
      remaining: payload.remaining ?? 0,
    };
  });

const confirmSchema = z.object({
  id: z.string().uuid(),
  orgnr: z.string().regex(ORGNR_RE),
  fromRegisterSearch: z.boolean().optional(),
});

type ConfirmPayload = {
  status?: string;
  company_id?: string | null;
  orgnr?: string | null;
  match_method?: string | null;
};

export const confirmCompanyReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => confirmSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "network_company_reconciliation_confirm" as never,
      {
        p_reconciliation_id: data.id,
        p_orgnr: data.orgnr,
        p_from_register_search: data.fromRegisterSearch ?? false,
      } as never,
    );
    const payload = (result ?? null) as ConfirmPayload | null;
    const status = error ? "write_failed" : payload?.status ?? "write_failed";
    const ok = status === "confirmed" || status === "already_confirmed";
    return {
      ok,
      status,
      companyId: payload?.company_id ?? null,
      orgnr: payload?.orgnr ?? null,
      matchMethod: payload?.match_method ?? null,
    };
  });

const bulkSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), orgnr: z.string().regex(ORGNR_RE) }))
    .min(1)
    .max(200),
});

/**
 * Bekrefter flere entydige kandidater. Hvert forslag behandles isolert:
 * ett som feiler påvirker aldri de øvrige.
 */
export const confirmCompanyReconciliationBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => bulkSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let confirmed = 0;
    let alreadyLinked = 0;
    const failures: Array<{ id: string; status: string }> = [];

    for (const item of data.items) {
      const { data: result, error } = await context.supabase.rpc(
        "network_company_reconciliation_confirm" as never,
        {
          p_reconciliation_id: item.id,
          p_orgnr: item.orgnr,
          p_from_register_search: false,
        } as never,
      );
      const payload = (result ?? null) as ConfirmPayload | null;
      const status = error ? "write_failed" : payload?.status ?? "write_failed";
      if (status === "confirmed") confirmed += 1;
      else if (status === "already_confirmed") alreadyLinked += 1;
      else failures.push({ id: item.id, status });
    }

    return {
      ok: true as const,
      requested: data.items.length,
      confirmed,
      alreadyLinked,
      failed: failures.length,
      failures,
    };
  });

const stateSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["rejected", "not_applicable", "reopen"]),
});

export const setCompanyReconciliationState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stateSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "network_company_reconciliation_set_state" as never,
      { p_reconciliation_id: data.id, p_state: data.state } as never,
    );
    const payload = (result ?? null) as { status?: string } | null;
    const status = error ? "write_failed" : payload?.status ?? "write_failed";
    return { ok: status === data.state || status === "reopened", status };
  });
