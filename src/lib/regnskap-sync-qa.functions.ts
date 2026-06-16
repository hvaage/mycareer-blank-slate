/**
 * Admin-only QA for M5.2 regnskap-sync.
 *
 * Server-side sequence:
 *   1) dryRun=true
 *   2) dryRun=false
 *   3) re-run dryRun=false
 *
 * Faste 5 orgnr. Tilbakerapport for verifisering i UI.
 *
 * MIDLERTIDIG — slett denne filen og /admin/regnskap-qa-ruten når M5.2 er lukket.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ORGNRS = [
  "923609016",
  "976239997",
  "984851006",
  "929877950",
  "984661185",
];

async function assertAdmin(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

type Snap = {
  organisasjonsnummer: string;
  regnskapsaar: number;
  regnskapstype: string;
  hentet_tidspunkt: string;
  raw_null: boolean;
};

export const runRegnskapSyncQa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const { runSync } = await import("@/lib/regnskap-sync.server");
    const { getSql } = await import("@/lib/regnskap-sync.db.server");

    const common = {
      mode: "orgnrs" as const,
      orgnrs: ORGNRS,
      limit: ORGNRS.length,
      includePdfYears: true,
      rps: 2.0,
      timeBudgetMs: 50_000,
      meta: { source: "admin-qa", admin_uid: userId },
    };

    // Step 1: dryRun
    const dryRun = await runSync({ ...common, dryRun: true });

    // Step 2: real run
    const real1 = await runSync({ ...common, dryRun: false });

    // Snapshot hentet_tidspunkt + raw_data NULL etter real1
    let sql = await getSql();
    const snapAfter1 = (await sql.unsafe(
      `SELECT organisasjonsnummer, regnskapsaar, regnskapstype,
              hentet_tidspunkt, (raw_data IS NULL) AS raw_null
       FROM reg.regnskap
       WHERE organisasjonsnummer = ANY($1::text[])
       ORDER BY organisasjonsnummer, regnskapsaar, regnskapstype`,
      [ORGNRS],
    )) as Snap[];

    // Step 3: re-run real
    const real2 = await runSync({ ...common, dryRun: false });

    // Verifisering
    sql = await getSql();
    const snapAfter2 = (await sql.unsafe(
      `SELECT organisasjonsnummer, regnskapsaar, regnskapstype,
              hentet_tidspunkt, (raw_data IS NULL) AS raw_null
       FROM reg.regnskap
       WHERE organisasjonsnummer = ANY($1::text[])
       ORDER BY organisasjonsnummer, regnskapsaar, regnskapstype`,
      [ORGNRS],
    )) as Snap[];

    const status = (await sql.unsafe(
      `SELECT organisasjonsnummer, status, attempts, last_http_status,
              records_lagret, latest_regnskapsaar, available_pdf_years,
              last_success_at, last_checked_at, last_error
       FROM reg.regnskap_sync_status
       WHERE organisasjonsnummer = ANY($1::text[])
       ORDER BY organisasjonsnummer`,
      [ORGNRS],
    )) as any[];

    const runIds = [real1.runId, real2.runId].filter(
      (x): x is number => typeof x === "number",
    );
    const runs = runIds.length
      ? ((await sql.unsafe(
          `SELECT id, mode, dry_run, status, duration_ms,
                  selected_count, checked_count, with_regnskap_count,
                  no_regnskap_count, failed_count, skipped_count,
                  records_lagret, http_429_count, http_503_count, retry_count,
                  started_at, finished_at
           FROM reg.regnskap_sync_runs
           WHERE id = ANY($1::bigint[])
           ORDER BY id`,
          [runIds],
        )) as any[])
      : [];

    const items = runIds.length
      ? ((await sql.unsafe(
          `SELECT run_id, organisasjonsnummer, status, http_status,
                  attempts, latency_ms, error
           FROM reg.regnskap_sync_run_items
           WHERE run_id = ANY($1::bigint[])
           ORDER BY run_id, organisasjonsnummer`,
          [runIds],
        )) as any[])
      : [];

    // hentet_tidspunkt uendret-sammenligning
    const key = (r: Snap) =>
      `${r.organisasjonsnummer}|${r.regnskapsaar}|${r.regnskapstype}`;
    const before = new Map(snapAfter1.map((r) => [key(r), r.hentet_tidspunkt]));
    const changed: { key: string; before: string; after: string }[] = [];
    let unchanged = 0;
    for (const r of snapAfter2) {
      const prev = before.get(key(r));
      if (!prev) continue; // ny rad — kan ikke sammenliknes
      if (new Date(prev).getTime() === new Date(r.hentet_tidspunkt).getTime()) {
        unchanged++;
      } else {
        changed.push({ key: key(r), before: prev, after: r.hentet_tidspunkt });
      }
    }

    const rawNullAll = snapAfter2.every((r) => r.raw_null === true);
    const attemptsAtLeast2 = status.every((s) => (s.attempts ?? 0) >= 2);

    return {
      orgnrs: ORGNRS,
      dryRun: summarize(dryRun),
      real1: summarize(real1),
      real2: summarize(real2),
      verification: {
        regnskap_rows: snapAfter2.length,
        raw_data_all_null: rawNullAll,
        hentet_tidspunkt_unchanged: unchanged,
        hentet_tidspunkt_changed: changed.length,
        hentet_tidspunkt_changed_sample: changed.slice(0, 5),
        attempts_at_least_2: attemptsAtLeast2,
      },
      status,
      runs,
      items,
    };
  });

function summarize(r: any) {
  return {
    runId: r.runId,
    status: r.status,
    selected: r.selected,
    checked: r.checked,
    withRegnskap: r.withRegnskap,
    noRegnskap: r.noRegnskap,
    failed: r.failed,
    skipped: r.skipped,
    recordsLagret: r.recordsLagret,
    http429: r.http429,
    http503: r.http503,
    retries: r.retries,
    durationMs: r.durationMs,
    stoppedReason: r.stoppedReason,
    items: r.items,
  };
}
