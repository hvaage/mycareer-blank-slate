// QA-sekvens for M5.2. Real → re-run + verifikasjon mot reg.* via SUPABASE_DB_URL.

import { runSync, type RunSyncResult } from "./runner.ts";
import { withClient } from "./db.ts";
import { tagStage } from "./_stage.ts";

type Snap = {
  organisasjonsnummer: string;
  regnskapsaar: number;
  regnskapstype: string;
  hentet_tidspunkt: string;
  raw_null: boolean;
};

function summarize(r: RunSyncResult) {
  return {
    runId: r.runId, status: r.status, selected: r.selected, checked: r.checked,
    withRegnskap: r.withRegnskap, noRegnskap: r.noRegnskap,
    failed: r.failed, skipped: r.skipped, recordsLagret: r.recordsLagret,
    http429: r.http429, http503: r.http503, retries: r.retries,
    durationMs: r.durationMs, stoppedReason: r.stoppedReason, items: r.items,
  };
}

export async function runQaSequence(orgnrs: string[], adminUid: string) {
  const common = {
    mode: "orgnrs" as const,
    orgnrs,
    limit: orgnrs.length,
    includePdfYears: true,
    rps: 2.0,
    timeBudgetMs: 50_000,
    meta: { source: "admin-qa", admin_uid: adminUid },
  };

  // before-snapshot for attempts-delta
  const before = await tagStage("qa_before", () => withClient(async (c) => {
    const r = await c.queryObject<{ organisasjonsnummer: string; attempts: number | null; status: string | null; last_success_at: string | null }>({
      text: `SELECT organisasjonsnummer, attempts, status, last_success_at
             FROM reg.regnskap_sync_status
             WHERE organisasjonsnummer = ANY($1::text[])
             ORDER BY organisasjonsnummer`,
      args: [orgnrs],
    });
    return r.rows;
  }));

  // Run real 1
  const real1 = await tagStage("qa_real1", () => runSync({ ...common, dryRun: false }));

  // mid-snapshot (hentet_tidspunkt etter real1)
  const snapAfter1 = await tagStage("qa_snap1", () => withClient(async (c) => {
    const r = await c.queryObject<Snap>({
      text: `SELECT organisasjonsnummer, regnskapsaar, regnskapstype,
                    to_char(hentet_tidspunkt,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hentet_tidspunkt,
                    (raw_data IS NULL) AS raw_null
             FROM reg.regnskap
             WHERE organisasjonsnummer = ANY($1::text[])
             ORDER BY organisasjonsnummer, regnskapsaar, regnskapstype`,
      args: [orgnrs],
    });
    return r.rows;
  }));

  // Re-run
  const real2 = await tagStage("qa_real2", () => runSync({ ...common, dryRun: false }));

  // after-snapshot
  const { snapAfter2, status, runs, items } = await tagStage("qa_after", () => withClient(async (c) => {
    const sa2 = await c.queryObject<Snap>({
      text: `SELECT organisasjonsnummer, regnskapsaar, regnskapstype,
                    to_char(hentet_tidspunkt,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hentet_tidspunkt,
                    (raw_data IS NULL) AS raw_null
             FROM reg.regnskap
             WHERE organisasjonsnummer = ANY($1::text[])
             ORDER BY organisasjonsnummer, regnskapsaar, regnskapstype`,
      args: [orgnrs],
    });
    const st = await c.queryObject<any>({
      text: `SELECT organisasjonsnummer, status, attempts, last_http_status,
                    records_lagret, latest_regnskapsaar, available_pdf_years,
                    last_success_at, last_checked_at, last_error
             FROM reg.regnskap_sync_status
             WHERE organisasjonsnummer = ANY($1::text[])
             ORDER BY organisasjonsnummer`,
      args: [orgnrs],
    });
    const runIds = [real1.runId, real2.runId].filter((x): x is number => typeof x === "number");
    const rs = runIds.length ? await c.queryObject<any>({
      text: `SELECT id, mode, dry_run, status, duration_ms,
                    selected_count, checked_count, with_regnskap_count,
                    no_regnskap_count, failed_count, skipped_count,
                    records_lagret, http_429_count, http_503_count, retry_count,
                    started_at, finished_at
             FROM reg.regnskap_sync_runs
             WHERE id = ANY($1::bigint[])
             ORDER BY id`,
      args: [runIds],
    }) : { rows: [] as any[] };
    const it = runIds.length ? await c.queryObject<any>({
      text: `SELECT run_id, organisasjonsnummer, status, http_status,
                    attempts, latency_ms, error
             FROM reg.regnskap_sync_run_items
             WHERE run_id = ANY($1::bigint[])
             ORDER BY run_id, organisasjonsnummer`,
      args: [runIds],
    }) : { rows: [] as any[] };
    return { snapAfter2: sa2.rows, status: st.rows, runs: rs.rows, items: it.rows };
  }));

  // attempts delta
  const beforeAttemptsByOrg = new Map(before.map((b) => [b.organisasjonsnummer, b.attempts ?? 0]));
  const attemptsDelta = status.map((s: any) => ({
    organisasjonsnummer: s.organisasjonsnummer,
    before: beforeAttemptsByOrg.get(s.organisasjonsnummer) ?? 0,
    after: s.attempts ?? 0,
    delta: (s.attempts ?? 0) - (beforeAttemptsByOrg.get(s.organisasjonsnummer) ?? 0),
  }));
  const allDeltaAtLeast2 = attemptsDelta.every((d) => d.delta >= 2);

  // hentet_tidspunkt unchanged
  const key = (r: Snap) => `${r.organisasjonsnummer}|${r.regnskapsaar}|${r.regnskapstype}`;
  const mid = new Map(snapAfter1.map((r) => [key(r), r.hentet_tidspunkt]));
  const changed: { key: string; before: string; after: string }[] = [];
  let unchanged = 0;
  for (const r of snapAfter2) {
    const prev = mid.get(key(r));
    if (!prev) continue;
    if (prev === r.hentet_tidspunkt) unchanged++;
    else changed.push({ key: key(r), before: prev, after: r.hentet_tidspunkt });
  }

  const rawNullAll = snapAfter2.every((r) => r.raw_null === true);
  const dryRunRunsRows = runs.filter((r: any) => r.dry_run === true).length;

  return {
    orgnrs,
    before,
    real1: summarize(real1),
    real2: summarize(real2),
    verification: {
      regnskap_rows: snapAfter2.length,
      raw_data_all_null: rawNullAll,
      hentet_tidspunkt_unchanged: unchanged,
      hentet_tidspunkt_changed: changed.length,
      hentet_tidspunkt_changed_sample: changed.slice(0, 5),
      attempts_delta: attemptsDelta,
      attempts_delta_at_least_2_all: allDeltaAtLeast2,
      runs_inserted: runs.length,
      runs_dry_run_inserted: dryRunRunsRows,
      runs_expected: 2,
    },
    status,
    runs,
    items,
  };
}
