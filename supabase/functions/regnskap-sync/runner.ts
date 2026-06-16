// Orchestrator. Port av src/lib/regnskap-sync.server.ts til Deno/edge.

import { regnskapRad, sampleOk, type RegnskapRow } from "./normalize.ts";
import { fetchRegnskap, fetchPdfYears, RateLimiter } from "./brreg.ts";
import {
  withClient, selectCandidates, ensureStatusRows, claimOrgs, releaseClaim,
  upsertRegnskap, writeFinalStatus, startRun, finishRun, insertRunItems,
  refreshLatestRegnskapMV, analyzeRegnskapTables, patchRunMeta,
  type SyncMode, type ClaimedOrg, type FinalStatus, type RunItem,
} from "./db.ts";
import { warmupSearch } from "./warmup.ts";
import { tagStage, StageError } from "./_stage.ts";

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
  orgnr: string; status: string; httpStatus?: number;
  error?: string; latencyMs?: number; recordsFunnet?: number;
};

export type RunSyncResult = {
  runId: number | null;
  status: "ok" | "partial" | "failed";
  selected: number; checked: number;
  withRegnskap: number; noRegnskap: number;
  failed: number; skipped: number; recordsLagret: number;
  http429: number; http503: number; retries: number;
  durationMs: number;
  stoppedReason: "done" | "time_budget" | "error";
  items: RunSyncItem[];
};

export async function runSync(input: RunSyncInput): Promise<RunSyncResult> {
  const t0 = Date.now();
  const mode = input.mode;
  const dryRun = input.dryRun ?? false;
  const limit = Math.min(input.limit ?? 50, 500);
  const timeBudgetMs = Math.min(input.timeBudgetMs ?? 20_000, 55_000);
  const rps = Math.min(input.rps ?? 0.2, 2.0);
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

  let runId: number | null = null;
  let lastErr: string | null = null;

  try {
    return await tagStage("db_connect", () => withClient(async (c) => {
      const candidates = await tagStage("select_candidates", () => selectCandidates(c, mode, limit, staleDays, input.orgnrs));
      if (candidates.length === 0) {
        result.durationMs = Date.now() - t0;
        if (!dryRun) {
          runId = await tagStage("start_run", () => startRun(c, { mode, dryRun, limit, staleDays, timeBudgetMs, rps, meta }));
          await tagStage("finish_run", () => finishRun(c, {
            runId: runId!, status: "ok", durationMs: result.durationMs,
            selected: 0, checked: 0, withRegnskap: 0, noRegnskap: 0,
            failed: 0, skipped: 0, recordsLagret: 0,
            http429: 0, http503: 0, retries: 0, lastError: null,
            extraMeta: { stoppedReason: "done", includePdfYears, candidateCount: 0 },
          }));
          result.runId = runId;
        }
        return result;
      }

      if (!dryRun) await tagStage("ensure_status", () => ensureStatusRows(c, candidates));

      let claimed: ClaimedOrg[];
      if (dryRun) {
        claimed = candidates.slice(0, limit).map((o) => ({ organisasjonsnummer: o, prevStatus: null }));
      } else {
        claimed = await tagStage("claim", () => claimOrgs(c, candidates, limit, mode));
      }
      result.selected = claimed.length;

      if (!dryRun) {
        runId = await tagStage("start_run", () => startRun(c, { mode, dryRun, limit, staleDays, timeBudgetMs, rps, meta }));
        result.runId = runId;
      }

      const limiter = new RateLimiter(rps);
      const runItems: RunItem[] = [];
      const stopThresholdMs = timeBudgetMs - 2000;

      for (let i = 0; i < claimed.length; i++) {
        const { organisasjonsnummer: orgnr, prevStatus } = claimed[i];
        if (Date.now() - t0 > stopThresholdMs) {
          result.stoppedReason = "time_budget";
          result.status = "partial";
          if (!dryRun) {
            for (let j = i; j < claimed.length; j++) {
              await releaseClaim(c, claimed[j].organisasjonsnummer, claimed[j].prevStatus);
              result.skipped++;
            }
          }
          break;
        }

        const fetchRes = await tagStage("brreg_fetch", () => fetchRegnskap(orgnr, limiter));
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
        } else if (fetchRes.kind === "no_regnskap") finalStatus = "no_regnskap";
        else if (fetchRes.kind === "not_found") finalStatus = "not_found";
        else if (fetchRes.kind === "forbidden") { finalStatus = "forbidden"; lastError = "http 403"; }
        else if (fetchRes.kind === "client_error") { finalStatus = "client_error"; lastError = fetchRes.error; }
        else { finalStatus = "retry"; lastError = (fetchRes as any).error; }

        if (includePdfYears && (finalStatus === "ok" || finalStatus === "no_regnskap")) {
          const pdf = await tagStage("brreg_fetch", () => fetchPdfYears(orgnr, limiter));
          if (pdf.kind === "ok") pdfYears = pdf.years;
          else if (pdf.kind === "none") pdfYears = [];
        }

        if (!dryRun) {
          if (normalized.length > 0) {
            for (const row of normalized) {
              try { await upsertRegnskap(c, row); }
              catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                finalStatus = "retry";
              }
            }
          }
          try {
            await writeFinalStatus(c, {
              orgnr, status: finalStatus, httpStatus,
              recordsFunnet, latestRegnskapsaar: latestAar,
              availablePdfYears: pdfYears, lastError,
            });
          } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
        }

        if (finalStatus === "ok") { result.withRegnskap++; result.recordsLagret += recordsFunnet; }
        else if (finalStatus === "no_regnskap" || finalStatus === "not_found") result.noRegnskap++;
        else result.failed++;

        result.items.push({
          orgnr, status: finalStatus,
          httpStatus: httpStatus ?? undefined,
          error: lastError ?? undefined,
          latencyMs: fetchRes.latencyMs, recordsFunnet,
        });

        if (!dryRun && runId !== null) {
          const isOk = finalStatus === "ok" || finalStatus === "no_regnskap" || finalStatus === "not_found";
          if (!isOk || sampleOk(orgnr)) {
            runItems.push({
              runId, orgnr, status: finalStatus, httpStatus,
              attempts: fetchRes.attempts, latencyMs: fetchRes.latencyMs, error: lastError,
            });
          }
        }
      }

      if (!dryRun && runId !== null) {
        try { await tagStage("insert_run_items", () => insertRunItems(c, runItems)); }
        catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
        result.durationMs = Date.now() - t0;
        const runStatus = (result.stoppedReason !== "done" || result.failed > 0) ? "partial" : "ok";
        await tagStage("finish_run", () => finishRun(c, {
          runId: runId!, status: runStatus, durationMs: result.durationMs,
          selected: result.selected, checked: result.checked,
          withRegnskap: result.withRegnskap, noRegnskap: result.noRegnskap,
          failed: result.failed, skipped: result.skipped,
          recordsLagret: result.recordsLagret,
          http429: result.http429, http503: result.http503, retries: result.retries,
          lastError: lastErr,
          extraMeta: { stoppedReason: result.stoppedReason, includePdfYears, candidateCount: candidates.length },
        }));
        result.status = runStatus;

        // ===== M5.4 post-batch: refresh MV, ANALYZE, warmup. Aldri throw, aldri
        // endre run.status. Resultatene patches inn i meta etter finishRun. =====
        if (result.checked > 0) {
          const post: Record<string, unknown> = {};
          try {
            const refreshMv = await refreshLatestRegnskapMV(c);
            post.refreshMv = refreshMv;
          } catch (e) {
            post.refreshMv = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          try {
            // Bare ANALYZE reg.enheter ved større batcher (>= 100 sjekkede).
            const includeEnheter = result.checked >= 100;
            const analyze = await analyzeRegnskapTables(c, { includeEnheter });
            post.analyze = analyze;
          } catch (e) {
            post.analyze = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          try {
            const warmup = await warmupSearch(c, { perQueryTimeoutMs: 1500, totalBudgetMs: 5000 });
            post.warmup = warmup;
          } catch (e) {
            post.warmup = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          try {
            await patchRunMeta(c, runId!, { post });
          } catch (e) {
            console.error("[runner] patchRunMeta failed:", e instanceof Error ? e.message : String(e));
          }
        }
      } else {
        result.durationMs = Date.now() - t0;
      }

      return result;
    }));
  } catch (e) {
    result.stoppedReason = "error";
    result.status = "failed";
    result.durationMs = Date.now() - t0;
    // Marker run som failed hvis vi rakk å starte den
    if (runId !== null) {
      try {
        await tagStage("finish_run_failed", () => withClient(async (c2) => finishRun(c2, {
          runId: runId!, status: "failed", durationMs: result.durationMs,
          selected: result.selected, checked: result.checked,
          withRegnskap: result.withRegnskap, noRegnskap: result.noRegnskap,
          failed: result.failed, skipped: result.skipped,
          recordsLagret: result.recordsLagret,
          http429: result.http429, http503: result.http503, retries: result.retries,
          lastError: e instanceof Error ? e.message : String(e),
          extraMeta: { stoppedReason: "error", includePdfYears, candidateCount: 0 },
        })));
      } catch (finishErr) {
        console.error("[runner] finishRun failed after exception:", finishErr);
      }
    }
    // attach runId for diagnostics
    if (e instanceof StageError) (e as any).runId = runId;
    else { const se = new StageError("unknown", e); (se as any).runId = runId; throw se; }
    throw e;
  }
}
