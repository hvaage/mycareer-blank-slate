// M5.4 search warmup. Kjører representative kall mot public.search_employers
// så første bruker etter sync slipper kald plan. Aldri throw — runneren logger.
//
// M5.4.1: Splittet i MAIN_VARIANTS (teller mot wu:n/m og run-status) og
// OBSERVE_VARIANTS (rene observasjoner; påvirker IKKE run-status).
// Bransje-grenene er trege av strukturelle grunner (OR-trær over
// naeringskode-prefixer + ILIKE på beskrivelser/aktivitet) og hører hjemme
// i et eget søk/ranking-arbeid — observeres her, men blokkerer ikke wu.

import type { PoolClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export type WarmupSample = { label: string; ms: number; ok: boolean; error?: string };
export type WarmupResult = {
  ok: boolean;
  durationMs: number;
  ran: number;
  okCount: number;
  failed: number;
  samples: WarmupSample[];
};

export type Variant = {
  label: string;
  params: Record<string, string | number | null>;
};

// Hoved-warmup: 3 trygge/raske varianter. Disse teller mot wu:n/m.
export const MAIN_VARIANTS: Variant[] = [
  { label: "default", params: {} },
  { label: "kommune_oslo", params: { p_kommune_query: "Oslo" } },
  { label: "min_omsetning_10m", params: { p_min_omsetning: 10_000_000 } },
];

// Observasjon: bransje-varianter. Eget søk/ranking-problem; logges, påvirker ikke status.
export const OBSERVE_VARIANTS: Variant[] = [
  { label: "bransje_it", params: { p_bransje_query: "it" } },
  { label: "bransje_bygg", params: { p_bransje_query: "bygg" } },
  { label: "bransje_regnskap", params: { p_bransje_query: "regnskap" } },
];

// Bygg "SELECT 1 FROM public.search_employers(p_x => $1, ..., p_limit => 1) LIMIT 1"
function buildCall(params: Record<string, string | number | null>): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  let i = 0;
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    i++;
    parts.push(`${k} => $${i}`);
    args.push(v);
  }
  parts.push(`p_limit => 1`);
  return {
    sql: `SELECT 1 FROM public.search_employers(${parts.join(", ")}) LIMIT 1`,
    args,
  };
}

/**
 * Kjør warmup-varianter. Hver query wrappes i transaksjon med SET LOCAL statement_timeout.
 * Stopper å starte nye varianter når totalbudsjettet er brukt. Aldri throw.
 */
export async function warmupSearch(
  c: PoolClient,
  opts: { variants?: Variant[]; perQueryTimeoutMs?: number; totalBudgetMs?: number } = {},
): Promise<WarmupResult> {
  const variants = opts.variants ?? MAIN_VARIANTS;
  const perQueryTimeoutMs = opts.perQueryTimeoutMs ?? 8000;
  const totalBudgetMs = opts.totalBudgetMs ?? 25000;
  const t0 = Date.now();
  const samples: WarmupSample[] = [];

  for (const v of variants) {
    if (Date.now() - t0 > totalBudgetMs) break;
    const { sql, args } = buildCall(v.params);
    const qt0 = Date.now();
    let ok = false;
    let error: string | undefined;
    try {
      await c.queryObject("BEGIN");
      try {
        await c.queryObject(`SET LOCAL statement_timeout = '${perQueryTimeoutMs}ms'`);
        await c.queryObject({ text: sql, args });
        ok = true;
      } finally {
        try { await c.queryObject("ROLLBACK"); } catch { /* */ }
      }
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
    samples.push({ label: v.label, ms: Date.now() - qt0, ok, ...(error ? { error } : {}) });
  }

  const okCount = samples.filter((s) => s.ok).length;
  return {
    ok: samples.length > 0 && samples.every((s) => s.ok),
    durationMs: Date.now() - t0,
    ran: samples.length,
    okCount,
    failed: samples.length - okCount,
    samples,
  };
}
