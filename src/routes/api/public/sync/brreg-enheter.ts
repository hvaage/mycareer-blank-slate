/**
 * ENHETSSPEIL — FULLNEDLASTING FRA BRREG (fase 1-3)
 * =================================================
 * Arkitektur A (chunket): hver fase er et eget kall, tilstanden ligger i
 * reg.brreg_full_sync_runs. Ingen fase antar at forrige fase kjørte i samme
 * prosess.
 *
 * Fase 1  POST ?phase=1            laster ned fullfilen til Storage og skriver
 *                                  forventet og faktisk filstørrelse.
 * Fase 2  POST ?phase=2&run_id=..  strømmer filen, filtrerer, avleder markører
 *                                  og mellomlagrer. Kalles flere ganger; hvert
 *                                  kall fortsetter fra radmarkøren.
 * Fase 3  POST ?phase=3&run_id=..  kjører sammenligningsporten og skriver til
 *                                  reg.enheter — upsert-only, aldri sletting.
 *
 * INGEN ANNEN KODE SKAL SKRIVE TIL reg.enheter. Se src/lib/brreg/enheter-rules.ts.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  evaluateComparisonGate,
  evaluateEmployerFilter,
  verifyDownloadIntegrity,
  type MarkerDiffCounts,
} from "@/lib/brreg/enheter-rules";
import { mapRecordToStagingRow, type BrregFullRecord } from "@/lib/brreg/enheter-mapping";
import { createJsonArrayScanner } from "@/lib/brreg/json-array-stream";

const BUCKET = "brreg-full";
const BRREG_URL = "https://data.brreg.no/enhetsregisteret/api/enheter/lastned";
const BRREG_ACCEPT = "application/vnd.brreg.enhetsregisteret.enhet.v2+gzip";
const BATCH_ROWS = 2000;
/**
 * Hvert fase 2-kall stopper her og returnerer markøren, slik at neste kall
 * fortsetter. Godt under plattformens 150 sekunder: en kontrollert stopp er
 * normal drift, en drept prosess er en feil, og de to må kunne skilles.
 */
const PHASE2_BUDGET_MS = 110_000;


const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (i < ab.length ? ab[i] : 0) ^ (i < bb.length ? bb[i] : 0);
  return diff === 0;
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function rpc<T>(admin: Admin, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn as never, args as never);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

interface RunRow {
  id: number;
  phase: string;
  status: string;
  storage_path: string | null;
  expected_bytes: number | null;
  actual_bytes: number | null;
  integrity_ok: boolean | null;
  row_cursor: number;
  rows_seen: number;
  rows_staged: number;
  rows_excluded: number;
  parse_complete: boolean;
  strict_gate: boolean;
}

// ---------------------------------------------------------------------------
// Fase 1 — nedlasting til Storage med integritetskontroll
// ---------------------------------------------------------------------------
async function phase1(admin: Admin, strict: boolean) {
  const run = await rpc<RunRow>(admin, "brreg_full_start_run", { p_strict: strict });
  const t0 = Date.now();
  const path = `enheter/${run.id}.json.gz`;

  try {
    const res = await fetch(BRREG_URL, { headers: { Accept: BRREG_ACCEPT } });
    if (!res.ok || !res.body) throw new Error(`brreg http ${res.status}`);
    const expected = Number(res.headers.get("content-length") ?? 0) || null;

    // Filen er ~209 MB og kan ikke holdes i minnet. Den strømmes rett til
    // Storage, byte for byte, mens bytene telles for integritetskontrollen.
    let actual = 0;
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          actual += chunk.byteLength;
          ctrl.enqueue(chunk);
        },
      }),
    );

    const up = await admin.storage
      .from(BUCKET)
      .upload(path, counted as unknown as Blob, {
        contentType: "application/gzip",
        upsert: true,
        duplex: "half",
      } as never);
    if (up.error) throw new Error(`storage: ${up.error.message}`);


    const integrity = verifyDownloadIntegrity({ expectedBytes: expected, actualBytes: actual });
    const patched = await rpc<RunRow>(admin, "brreg_full_patch_run", {
      p_run_id: run.id,
      p_patch: {
        phase: integrity.ok ? "phase1_done" : "phase1_download",
        status: integrity.ok ? "awaiting_phase2" : "failed",
        storage_bucket: BUCKET,
        storage_path: path,
        expected_bytes: expected,
        actual_bytes: actual,
        integrity_ok: integrity.ok,
        integrity_reason: integrity.reason ?? null,
        download_ms: Date.now() - t0,
        ...(integrity.ok ? {} : { finished: true, error: `integrity:${integrity.reason}` }),
      },
    });
    return json({ ok: integrity.ok, phase: 1, run: patched }, integrity.ok ? 200 : 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc(admin, "brreg_full_patch_run", {
      p_run_id: run.id,
      p_patch: { status: "failed", error: msg, finished: true },
    });
    return json({ ok: false, phase: 1, run_id: run.id, error: msg }, 500);
  }
}

// ---------------------------------------------------------------------------
// Fase 2 — strøm, filtrer, mellomlagre. Fortsetter fra radmarkøren.
// ---------------------------------------------------------------------------
async function phase2(admin: Admin, runId: number, maxRows: number | null) {
  const run = await rpc<RunRow>(admin, "brreg_full_get_run", { p_run_id: runId });
  if (!run) return json({ ok: false, error: "unknown run" }, 404);
  if (run.integrity_ok !== true) {
    return json(
      { ok: false, phase: 2, error: "fase 1 er ikke verifisert komplett — fase 2 avbrutt", run },
      409,
    );
  }
  if (run.parse_complete) return json({ ok: true, phase: 2, done: true, run });

  // Signert URL + strømmende fetch. `storage.download()` bufrer hele blobben
  // (209 MB) i minnet før første byte kan leses, og henger i praksis.
  const signed = await admin.storage.from(BUCKET).createSignedUrl(run.storage_path!, 3600);
  if (signed.error || !signed.data) {
    return json({ ok: false, error: `storage: ${signed.error?.message}` }, 500);
  }
  const fileRes = await fetch(signed.data.signedUrl);
  if (!fileRes.ok || !fileRes.body) {
    return json({ ok: false, error: `storage http ${fileRes.status}` }, 500);
  }
  const storedBytes = Number(fileRes.headers.get("content-length") ?? 0) || null;
  if (storedBytes !== null && storedBytes !== Number(run.actual_bytes)) {
    return json(
      { ok: false, error: "lagret fil avviker fra registrert størrelse", storedBytes, run },
      409,
    );
  }

  const stream = fileRes.body.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

  const scanner = createJsonArrayScanner();

  const skip = Number(run.row_cursor ?? 0);
  const stopAt = maxRows && maxRows > 0 ? skip + maxRows : null;
  let seen = 0;
  let processed = 0;
  let rows: Record<string, unknown>[] = [];
  let excluded: { organisasjonsnummer: string; reason: string }[] = [];
  const t0 = Date.now();
  let done = false;
  /** "done" = filen er lest ut. "budget"/"max_rows" = kontrollert stopp. */
  let stopReason: "done" | "budget" | "max_rows" = "done";

  const flush = async () => {
    if (!rows.length && !excluded.length) return;
    await rpc(admin, "brreg_full_stage_batch", {
      p_run_id: runId,
      p_rows: rows,
      p_excluded: excluded,
      p_row_cursor: seen,
      p_rows_seen: seen,
    });
    rows = [];
    excluded = [];
  };

  try {
    outer: while (true) {
      const { value, done: rdone } = await reader.read();
      if (rdone) {
        done = true;
        stopReason = "done";
        break;
      }
      for (const raw of scanner.push(value)) {
        seen++;
        if (seen <= skip) continue;
        let rec: BrregFullRecord;
        try {
          rec = JSON.parse(raw) as BrregFullRecord;
        } catch (e) {
          throw new Error(`parsefeil på rad ${seen}: ${(e as Error).message}`);
        }
        const decision = evaluateEmployerFilter(rec);
        if (decision.include) rows.push(mapRecordToStagingRow(rec));
        else
          excluded.push({
            organisasjonsnummer: rec.organisasjonsnummer,
            reason: decision.reason ?? "unknown",
          });
        processed++;

        if (stopAt !== null && seen >= stopAt) {
          stopReason = "max_rows";
          break outer;
        }
        if (rows.length + excluded.length >= BATCH_ROWS && Date.now() - t0 > PHASE2_BUDGET_MS) {
          stopReason = "budget";
          break outer;
        }
        if (rows.length + excluded.length >= BATCH_ROWS) await flush();
      }
      // Tidsbudsjettet sjekkes også mellom bitene, ikke bare på hel batch,
      // slik at et parti med bare hoppede rader også avsluttes kontrollert.
      if (Date.now() - t0 > PHASE2_BUDGET_MS) {
        stopReason = "budget";
        break;
      }
    }
    await flush();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc(admin, "brreg_full_patch_run", {
      p_run_id: runId,
      p_patch: { status: "failed", error: msg, finished: true },
    });
    return json({ ok: false, phase: 2, error: msg, row_cursor: seen }, 500);
  } finally {
    await reader.cancel().catch(() => {});
  }

  const patched = await rpc<RunRow>(admin, "brreg_full_patch_run", {
    p_run_id: runId,
    p_patch: {
      phase: done ? "phase2_done" : "phase2_parse",
      // Kontrollert stopp har sin egen status. Uten den ville hver eneste
      // normale kjøring sett ut som en avbrutt kjøring.
      status: done ? "awaiting_phase3" : "awaiting_next_batch",
      parse_complete: done,
      row_cursor: seen,
      rows_seen: seen,
      error: null,
    },
  });
  const elapsed = Date.now() - t0;
  return json({
    ok: true,
    phase: 2,
    done,
    stop_reason: stopReason,
    progress: {
      row_cursor: patched.row_cursor,
      rows_staged: patched.rows_staged,
      rows_excluded: patched.rows_excluded,
      rows_this_call: processed,
      elapsed_ms: elapsed,
      rows_per_s: processed > 0 ? Math.round((processed / elapsed) * 1000) : 0,
    },
    run: patched,
  });
}



// ---------------------------------------------------------------------------
// Fase 3 — sammenligningsport, deretter upsert-only merge
// ---------------------------------------------------------------------------
interface GateMetrics {
  filtered_count: number;
  mirror_count: number;
  overlap_count: number;
  excluded_count: number;
  excluded_present_in_mirror: number;
  absent_from_source: number;
  new_rows: number;
  marker_diffs: MarkerDiffCounts;
  samples: Record<string, string[]>;
}

/**
 * Hver delport kjøres som SITT EGET kall. Den samlede porten er én spørring på
 * ~60 sekunder og treffer statement timeout; delt opp er ingen del over ~20 s,
 * og hver del får sin egen varighet i svaret. `excluded_present_in_mirror` kan
 * dermed også kjøres og leses alene — den er beviset på om rekonstruksjonen av
 * filteret er ufullstendig.
 */
async function runGatePart<T>(
  admin: Admin,
  fn: string,
  runId: number,
  timings: Record<string, number>,
): Promise<T> {
  const t = Date.now();
  const out = await rpc<T>(admin, fn, { p_run_id: runId });
  timings[fn.replace("brreg_full_gate_", "")] = Date.now() - t;
  return out;
}

/**
 * Skriving alene, uten porten. Porten er allerede kjørt og godkjent for
 * kjøringen; å kjøre den om igjen for hver porsjon koster to minutter og
 * sprenger tidsbudsjettet til gatewayen. Kallet er trygt å gjenta: hver
 * porsjon merkes i mellomlagringen.
 *
 * Telleren for «manglet i fullfilen» settes IKKE her. Den er et eget steg
 * (?phase=missing) som først kjører når alle porsjoner er bekreftet ferdige,
 * og som er idempotent. Ellers ville en feilet eller gjentatt siste porsjon
 * gi feil teller.
 */
async function mergeOnly(admin: Admin, runId: number) {
  const budgetMs = 100_000;
  const t0 = Date.now();
  const out = { upserted: 0, batches: 0, remaining: -1, done: false };
  while (Date.now() - t0 < budgetMs) {
    const step = await rpc<{ upserted: number; remaining: number; done: boolean }>(
      admin,
      "brreg_full_merge",
      { p_run_id: runId, p_batch: 25_000 },
    );
    out.upserted += step.upserted;
    out.batches += 1;
    out.remaining = step.remaining;
    if (step.done) {
      out.done = true;
      await rpc(admin, "brreg_full_patch_run", {
        p_run_id: runId,
        p_patch: { phase: "phase3_merged", status: "awaiting_missing_count" },
      });
      break;
    }
    if (step.upserted === 0) return json({ ok: false, phase: "merge", error: "ingen fremdrift", ...out }, 500);
  }
  return json({ ok: true, phase: "merge", ...out });
}

/**
 * Eget steg etter siste porsjon. Idempotent i databasen: gjentatt kall
 * dobbelttelller ikke, det svarer already_applied.
 */
async function applyMissing(admin: Admin, runId: number) {
  const res = await rpc<{ ok: boolean; missing?: number; already_applied?: boolean; reason?: string }>(
    admin,
    "brreg_full_apply_missing",
    { p_run_id: runId },
  );
  if (!res.ok) return json({ ...res, ok: false, phase: "missing" }, 409);
  await rpc(admin, "brreg_full_patch_run", {
    p_run_id: runId,
    p_patch: { phase: "phase3_done", status: "ok", finished: true },
  });
  return json({ ...res, ok: true, phase: "missing" });
}


async function phase3(admin: Admin, runId: number, dryRun: boolean) {
  const run = await rpc<RunRow>(admin, "brreg_full_get_run", { p_run_id: runId });
  if (!run) return json({ ok: false, error: "unknown run" }, 404);
  if (!run.parse_complete) return json({ ok: false, error: "fase 2 er ikke fullført" }, 409);

  const gate_ms: Record<string, number> = {};
  const counts = await runGatePart<{
    filtered_count: number;
    excluded_count: number;
    mirror_count: number;
  }>(admin, "brreg_full_gate_counts", runId, gate_ms);
  const overlap = await runGatePart<{
    overlap_count: number;
    new_rows: number;
    new_rows_samples: string[];
  }>(admin, "brreg_full_gate_overlap", runId, gate_ms);
  const markers = await runGatePart<MarkerDiffCounts>(
    admin,
    "brreg_full_gate_markers",
    runId,
    gate_ms,
  );
  const excluded = await runGatePart<{
    excluded_present_in_mirror: number;
    by_reason: Record<string, number>;
    samples: string[];
  }>(admin, "brreg_full_gate_excluded_in_mirror", runId, gate_ms);
  const absent = await runGatePart<{ absent_from_source: number; samples: string[] }>(
    admin,
    "brreg_full_gate_absent",
    runId,
    gate_ms,
  );

  const m: GateMetrics = {
    filtered_count: counts.filtered_count,
    excluded_count: counts.excluded_count,
    mirror_count: counts.mirror_count,
    overlap_count: overlap.overlap_count,
    new_rows: overlap.new_rows,
    marker_diffs: markers,
    excluded_present_in_mirror: excluded.excluded_present_in_mirror,
    absent_from_source: absent.absent_from_source,
    samples: {
      new_rows: overlap.new_rows_samples,
      excluded_present_in_mirror: excluded.samples,
      absent_from_source: absent.samples,
    },
  };

  const gate = evaluateComparisonGate({
    filteredCount: m.filtered_count,
    mirrorCount: m.mirror_count,
    overlapCount: m.overlap_count,
    markerDiffs: m.marker_diffs,
    strict: run.strict_gate,
    excludedPresentInMirror: m.excluded_present_in_mirror,
    absentFromSource: m.absent_from_source,
  });

  await rpc(admin, "brreg_full_patch_run", {
    p_run_id: runId,
    p_patch: {
      gate: { ...m, ...gate, excluded_by_reason: excluded.by_reason, gate_ms },
      gate_pass: gate.pass,
      phase: "phase3_gate",
    },
  });

  if (!gate.pass || dryRun) {
    // Rader speilet har men filteret forkastet blir RAPPORTERT, aldri slettet.
    await rpc(admin, "brreg_full_patch_run", {
      p_run_id: runId,
      p_patch: gate.pass
        ? { status: "gate_ok_dry_run" }
        : { status: "gate_failed", error: gate.failures.join("; "), finished: true },
    });
    return json({
      ok: gate.pass,
      phase: 3,
      merged: false,
      dry_run: dryRun,
      gate,
      gate_ms,
      metrics: m,
      excluded_by_reason: excluded.by_reason,
    });
  }


  // Skrivingen går i porsjoner: én samlet upsert på ~443 000 rader sprenger
  // tidsgrensen. Hver porsjon merkes i mellomlagringen, så kallet kan gjentas
  // uten å skrive noe om igjen. Telleren for manglende rader settes IKKE her,
  // men i ?phase=missing etter at alle porsjoner er bekreftet ferdige.
  const MERGE_BATCH = 50_000;
  const merged = { upserted: 0, batches: 0, done: false };
  for (let i = 0; i < 40; i++) {
    const step = await rpc<{
      upserted: number;
      remaining: number;
      done: boolean;
    }>(admin, "brreg_full_merge", { p_run_id: runId, p_batch: MERGE_BATCH });
    merged.upserted += step.upserted;
    merged.batches += 1;
    if (step.done) {
      merged.done = true;
      break;
    }
    if (step.upserted === 0) {
      return json(
        { ok: false, phase: 3, error: "merge stoppet uten fremdrift", merged, gate, metrics: m },
        500,
      );
    }
  }
  // Mellomlagringen beholdes med vilje: den er dokumentasjonen for hva kjøringen skrev.
  const patched = await rpc<RunRow>(admin, "brreg_full_patch_run", {
    p_run_id: runId,
    p_patch: merged.done
      ? { phase: "phase3_merged", status: "awaiting_missing_count" }
      : { phase: "phase3_merge", status: "awaiting_next_merge_batch" },
  });
  return json({
    ok: true,
    phase: 3,
    merged: merged.done,
    next: merged.done ? "phase=missing" : "phase=merge",
    gate,
    metrics: m,
    result: merged,
    run: patched,
  });
}

/**
 * ?phase=auto — ETT steg per kall, drevet av kjøringens egen tilstand.
 *
 * Cron kan ikke kjøre hele importen i ett kall: hvert steg har eget
 * tidsbudsjett under gatewayens grense. Startjobben (1. og 15.) kaller med
 * start=1 og oppretter en ny kjøring; driverjobben kaller uten start og
 * flytter en pågående kjøring ett steg videre. Ingen kjøring i arbeid gir
 * `idle`, ikke feil — det er normaltilstanden mellom importene.
 */
async function auto(admin: Admin, start: boolean) {
  const run = await rpc<RunRow & { finished?: boolean; error?: string | null } | null>(
    admin,
    "brreg_full_get_run",
    { p_run_id: null },
  );
  const active = run && run.status !== "ok" && run.status !== "failed" && !run.finished;

  if (!active) {
    if (!start) return json({ ok: true, phase: "auto", step: "idle", run });
    return await phase1(admin, false);
  }

  switch (run!.status) {
    case "awaiting_phase2":
    case "awaiting_next_batch":
      return await phase2(admin, run!.id, null);
    case "awaiting_phase3":
      return await phase3(admin, run!.id, false);
    case "awaiting_next_merge_batch":
      return await mergeOnly(admin, run!.id);
    case "awaiting_missing_count":
      return await applyMissing(admin, run!.id);
    default:
      return json({ ok: false, phase: "auto", step: "ukjent tilstand", run }, 409);
  }
}

export const Route = createFileRoute("/api/public/sync/brreg-enheter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // To likeverdige kallere: manuelt kall med delt hemmelighet, eller
        // pg_cron som sender tjenestenøkkelen fra vault som Bearer.
        const secret = process.env["BRREG_SYNC_SECRET"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
        const provided = request.headers.get("x-cron-secret") ?? "";
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!secret) return json({ ok: false, error: "BRREG_SYNC_SECRET mangler" }, 503);
        const authorized =
          (provided !== "" && timingSafeEqualStr(secret, provided)) ||
          (bearer !== "" && serviceKey !== "" && timingSafeEqualStr(bearer, serviceKey));
        if (!authorized) return json({ ok: false, error: "unauthorized" }, 401);


        const url = new URL(request.url);
        const phase = url.searchParams.get("phase") ?? "1";
        const runId = Number(url.searchParams.get("run_id") ?? 0);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          if (phase === "auto") return await auto(supabaseAdmin, url.searchParams.get("start") === "1");
          if (phase === "1") return await phase1(supabaseAdmin, url.searchParams.get("strict") === "1");

          if (phase === "2")
            return await phase2(
              supabaseAdmin,
              runId,
              Number(url.searchParams.get("max_rows") ?? 0) || null,
            );
          if (phase === "merge") return await mergeOnly(supabaseAdmin, runId);
          if (phase === "missing") return await applyMissing(supabaseAdmin, runId);
          if (phase === "3")
            return await phase3(supabaseAdmin, runId, url.searchParams.get("dry_run") === "1");
          if (phase === "status")
            return json({ ok: true, run: await rpc(supabaseAdmin, "brreg_full_get_run", { p_run_id: runId || null }) });
          return json({ ok: false, error: "ukjent fase" }, 400);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[brreg-enheter-sync]", msg);
          return json({ ok: false, error: msg }, 500);
        }
      },
    },
  },
});
