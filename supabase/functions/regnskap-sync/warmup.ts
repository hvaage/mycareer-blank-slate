// M5.4 search warmup. Kjører noen representative kall mot public.search_employers
// så første bruker etter sync slipper kald plan. Aldri throw — runneren logger.

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

type Variant = {
  label: string;
  params: Record<string, string | number | null>;
};

// Konservativt sett. Alle med p_limit => 1, navngitte parametre.
const VARIANTS: Variant[] = [
  { label: "default", params: {} },
  { label: "bransje_it", params: { p_bransje_query: "it" } },
  { label: "bransje_bygg", params: { p_bransje_query: "bygg" } },
  { label: "min_omsetning_10m", params: { p_min_omsetning: 10_000_000 } },
  { label: "kommune_oslo", params: { p_kommune_query: "Oslo" } },
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
 * Kjør warmup-varianter. Hver query wraps i transaksjon med SET LOCAL statement_timeout.
 * Total budsjett ~5s; vi stopper å starte nye varianter når budsjettet er brukt.
 * Aldri throw.
 */
export async function warmupSearch(
  c: PoolClient,
  opts: { perQueryTimeoutMs?: number; totalBudgetMs?: number } = {},
): Promise<WarmupResult> {
  const perQueryTimeoutMs = opts.perQueryTimeoutMs ?? 8000;
  const totalBudgetMs = opts.totalBudgetMs ?? 30000;
  const t0 = Date.now();
  const samples: WarmupSample[] = [];

  for (const v of VARIANTS) {
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
