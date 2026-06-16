/**
 * runSync — server-only orchestrator for regnskap-sync.
 *
 * @server-only — importeres ikke fra client. Frontend kaller aldri direkte.
 * I M5.2 finnes ingen endpoint; modulen kalles fra interne testskript.
 */

import { regnskapRad, sampleOk, type RegnskapRow } from "./regnskap-sync.normalize";
import { fetchRegnskap, fetchPdfYears, RateLimiter } from "./regnskap-sync.brreg";
import {
  getSql, closeSql,
  selectCandidates, ensureStatusRows, claimOrgs, releaseClaim,
  upsertRegnskap, writeFinalStatus,
  startRun, finishRun, insertRunItems,
  type SyncMode, type ClaimedOrg, type FinalStatus, type RunItem,
} from "./regnskap-sync.db.server";

export type RunSyncInput = {
  mode: SyncMode;
  orgnrs?: string[];
  limit?: number;
  dryRun?: boolean;
  timeBudgetMs?: number;
  rps?: number;
  staleDays?: number;
  includePdfYears?: boolean;
  meta?: Record<string, unknown>;
};

export type RunSyncItem = {
  orgnr: string;
  status: string;
  httpStatus?: number;
  error?: string;
  latencyMs?: number;
  recordsFunnet?: number;
};

export type RunSyncResult = {
  runId: number | null;
  status: "ok" | "partial" | "failed";
  selected: number;
  checked: number;
  withRegnskap: number;
  noRegnskap: number;
  failed: number;
  skipped: number;
  recordsLagret: number;
  http429: number;
  http503: number;
  retries: number;
  durationMs: number;
  stoppedReason: "done" | "time_budget" | "error";
  items: RunSyncItem[];
};

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function runSync(input: RunSyncInput): Promise<RunSyncResult> {
  const t0 = Date.now();
  const mode = input.mode;
  const dryRun = input.dryRun ?? false;
  const limit = Math.min(input.limit ?? envNum("BRREG_BATCH_LIMIT", 50), 500);
  const timeBudgetMs = Math.min(input.timeBudgetMs ?? envNum("BRREG_TIME_BUDGET_MS", 20_000), 55_000);
  const rps = Math.min(input.rps ?? envNum("BRREG_RPS", 0.2), 2.0);
  const staleDays = input.staleDays ?? 180;
  const includePdfYears = input.includePdfYears ?? true;
  const meta = input.meta ?? {};

  const result: RunSyncResult = {
    runId: null, status: "ok",
    selected: 0, checked: 0, withRegnskap: 0, noRegnskap: 0,
    failed: 0, skipped: 0, recordsLagret: 0,
    http429: 0, http503: 0, retries: 0,
    durationMs: 0, stoppedReason: "done", items: [],
  };

  let sql: any = null;
  let runId: number | null = null;
  let lastErr: string | null = null;

  try {
    sql = await getSql();

    // 1) Velg kandidater
    const candidates = await selectCandidates(sql, mode, limit, staleDays, input.orgnrs);
    if (candidates.length === 0) {
      result.durationMs = Date.now() - t0;
      if (!dryRun) {
        runId = await startRun(sql, { mode, dryRun, limit, staleDays, timeBudgetMs, rps, meta });
        await finishRun(sql, {
          runId, status: "ok", durationMs: result.durationMs,
          selected: 0, checked: 0, withRegnskap: 0, noRegnskap: 0,
          failed: 0, skipped: 0, recordsLagret: 0,
          http429: 0, http503: 0, retries: 0, lastError: null,
          extraMeta: { stoppedReason: "done", includePdfYears, candidateCount: 0 },
        });
        result.runId = runId;
      }
      return result;
    }

    // 2) Sørg for statusrader
    if (!dryRun) await ensureStatusRows(sql, candidates);

    // 3) Claim med re-sjekk av claimbar regel
    let claimed: ClaimedOrg[];
    if (dryRun) {
      // DryRun: ingen lock/update, bare simulér valg av første N
      claimed = candidates.slice(0, limit).map((o) => ({ organisasjonsnummer: o, prevStatus: null }));
    } else {
      claimed = await claimOrgs(sql, candidates, limit, mode);
    }
    result.selected = claimed.length;

    // 4) Start run-row
    if (!dryRun) {
      runId = await startRun(sql, { mode, dryRun, limit, staleDays, timeBudgetMs, rps, meta });
      result.runId = runId;
    }

    // 5) Iterer claimed med tidsbudsjett
    const limiter = new RateLimiter(rps);
    const runItems: RunItem[] = [];
    const stopThresholdMs = timeBudgetMs - 2000;

    for (let i = 0; i < claimed.length; i++) {
      const { organisasjonsnummer: orgnr, prevStatus } = claimed[i];
      const elapsed = Date.now() - t0;
      if (elapsed > stopThresholdMs) {
        result.stoppedReason = "time_budget";
        result.status = "partial";
        // Rollback gjenværende claims
        if (!dryRun) {
          for (let j = i; j < claimed.length; j++) {
            await releaseClaim(sql, claimed[j].organisasjonsnummer, claimed[j].prevStatus);
            result.skipped++;
          }
        }
        break;
      }

      const fetchRes = await fetchRegnskap(orgnr, limiter);
      result.http429 += fetchRes.http429;
      result.http503 += fetchRes.http503;
      result.retries += Math.max(0, fetchRes.attempts - 1);
      result.checked++;

      let finalStatus: FinalStatus;
      let recordsFunnet = 0;
      let latestAar: number | null = null;
      let pdfYears: number[] | null = null;
      let normalized: RegnskapRow[] = [];
      let lastError: string | null = null;
      const httpStatus = (fetchRes as any).status ?? null;

      if (fetchRes.kind === "ok") {
        normalized = fetchRes.data.map((rr) => regnskapRad(orgnr, rr));
        const yrs = normalized.map((r) => r.regnskapsaar).filter((y): y is number => y !== null);
        latestAar = yrs.length ? Math.max(...yrs) : null;
        recordsFunnet = normalized.length;
        finalStatus = "ok";
      } else if (fetchRes.kind === "no_regnskap") {
        finalStatus = "no_regnskap";
      } else if (fetchRes.kind === "not_found") {
        finalStatus = "not_found";
      } else if (fetchRes.kind === "forbidden") {
        finalStatus = "forbidden";
        lastError = "http 403";
      } else if (fetchRes.kind === "client_error") {
        finalStatus = "client_error";
        lastError = fetchRes.error;
      } else {
        finalStatus = "retry";
        lastError = fetchRes.error;
      }

      // PDF-år (kun ved 2xx, og kun hvis gated på)
      if (includePdfYears && (finalStatus === "ok" || finalStatus === "no_regnskap")) {
        const pdf = await fetchPdfYears(orgnr, limiter);
        if (pdf.kind === "ok") pdfYears = pdf.years;
        else if (pdf.kind === "none") pdfYears = [];
      }

      // Upsert + statusoppdatering
      if (!dryRun) {
        if (normalized.length > 0) {
          for (const row of normalized) {
            try {
              await upsertRegnskap(sql, row);
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e);
              finalStatus = "retry";
            }
          }
        }
        try {
          await writeFinalStatus(sql, {
            orgnr,
            status: finalStatus,
            httpStatus,
            recordsFunnet,
            latestRegnskapsaar: latestAar,
            availablePdfYears: pdfYears,
            lastError,
          });
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }

      // Counters
      if (finalStatus === "ok") {
        result.withRegnskap++;
        result.recordsLagret += recordsFunnet;
      } else if (finalStatus === "no_regnskap") {
        result.noRegnskap++;
      } else {
        result.failed++;
      }

      result.items.push({
        orgnr,
        status: finalStatus,
        httpStatus: httpStatus ?? undefined,
        error: lastError ?? undefined,
        latencyMs: fetchRes.latencyMs,
        recordsFunnet,
      });

      // Run-item: alle feil + 1% OK-sample
      if (!dryRun && runId !== null) {
        const isOk = finalStatus === "ok" || finalStatus === "no_regnskap";
        if (!isOk || sampleOk(orgnr)) {
          runItems.push({
            runId,
            orgnr,
            status: finalStatus,
            httpStatus,
            attempts: fetchRes.attempts,
            latencyMs: fetchRes.latencyMs,
            error: lastError,
          });
        }
      }
    }

    // 6) Skriv run-items + finish-run
    if (!dryRun && runId !== null) {
      try {
        await insertRunItems(sql, runItems);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      result.durationMs = Date.now() - t0;
      const runStatus =
        result.status === "partial" ? "partial" : (result.failed > 0 && result.checked === result.failed ? "failed" : "ok");
      await finishRun(sql, {
        runId,
        status: runStatus,
        durationMs: result.durationMs,
        selected: result.selected,
        checked: result.checked,
        withRegnskap: result.withRegnskap,
        noRegnskap: result.noRegnskap,
        failed: result.failed,
        skipped: result.skipped,
        recordsLagret: result.recordsLagret,
        http429: result.http429,
        http503: result.http503,
        retries: result.retries,
        lastError: lastErr,
        extraMeta: {
          stoppedReason: result.stoppedReason,
          includePdfYears,
          candidateCount: candidates.length,
        },
      });
      result.status = runStatus;
    } else {
      result.durationMs = Date.now() - t0;
    }

    return result;
  } catch (e) {
    result.stoppedReason = "error";
    result.status = "failed";
    result.durationMs = Date.now() - t0;
    lastErr = e instanceof Error ? e.message : String(e);
    if (sql && runId !== null && !dryRun) {
      try {
        await finishRun(sql, {
          runId,
          status: "failed",
          durationMs: result.durationMs,
          selected: result.selected,
          checked: result.checked,
          withRegnskap: result.withRegnskap,
          noRegnskap: result.noRegnskap,
          failed: result.failed,
          skipped: result.skipped,
          recordsLagret: result.recordsLagret,
          http429: result.http429,
          http503: result.http503,
          retries: result.retries,
          lastError: lastErr,
          extraMeta: { stoppedReason: "error", includePdfYears, error: lastErr },
        });
      } catch { /* ignore */ }
    }
    throw e;
  } finally {
    await closeSql();
  }
}
