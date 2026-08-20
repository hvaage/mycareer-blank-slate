/**
 * LINKEDIN-IMPORT — BAKGRUNNSARBEIDER
 * ===================================
 * Kalles av pg_cron hvert minutt. Ruten ligger under /api/public/ fordi cron
 * ikke har brukersesjon; sikkerheten er delt hemmelighet i header
 * (x-worker-secret) eller tjenestenøkkel som Bearer.
 *
 *   POST ?action=run    plukker opp modne jobber og arbeider til budsjettet er brukt
 *   POST ?action=reap   rydder opp i jobber der arbeideren har falt bort
 *
 * Arbeideren skriver aldri produktdata — kun linkedin_*-tabellene og forslag.
 */
import { createFileRoute } from "@tanstack/react-router";
import type { LinkedInPurpose } from "@/lib/linkedin/contract";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (i < ab.length ? ab[i]! : 0) ^ (i < bb.length ? bb[i]! : 0);
  return diff === 0;
}

/** Samlet tidsbudsjett per invokasjon. pg_net avbryter etter 150 s. */
const INVOCATION_BUDGET_MS = 50_000;
/** Leaselengde: må være romslig større enn budsjettet. */
const LEASE_SECONDS = 180;

type Admin = { from: (t: string) => any; rpc: (fn: string, args?: unknown) => any; storage: any };

type ClaimedAttempt = {
  attempt_id: string;
  import_id: string;
  user_id: string;
  attempt_number: number;
  phase: string;
  cursor_json: { fileIndex?: number; stagedRecords?: number; reconciled?: boolean } | null;
  retry_count: number;
  archive_storage_path: string | null;
  purposes: string[];
};

/** Feil som er verdt et nytt forsøk (nettverk, tidsavbrudd, midlertidig backend). */
function isRetryable(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /timeout|timed out|network|fetch failed|econn|socket|temporarily|503|502|504/.test(message);
}

async function processAttempt(
  admin: Admin,
  job: ClaimedAttempt,
  leaseOwner: string,
  deadline: number,
): Promise<"done" | "yielded" | "cancelled" | "failed"> {
  const cursor = job.cursor_json ?? {};
  const importId = job.import_id;
  const userId = job.user_id;

  // 1) Hent arkivet fra lagring. Uten arkiv kan importen aldri fullføres.
  if (!job.archive_storage_path) {
    await admin.rpc("linkedin_import_fail_attempt", {
      p_attempt_id: job.attempt_id,
      p_error_code: "archive_missing",
      p_error_summary: "Arkivet finnes ikke i lagringen.",
      p_retryable: false,
    });
    return "failed";
  }

  const download = await admin.storage.from("linkedin-imports").download(job.archive_storage_path);
  if (download.error || !download.data) {
    await admin.rpc("linkedin_import_fail_attempt", {
      p_attempt_id: job.attempt_id,
      p_error_code: "archive_unreadable",
      p_error_summary: "Kunne ikke lese arkivet fra lagringen.",
      p_retryable: true,
    });
    return "failed";
  }
  const archive = new Uint8Array(await (download.data as Blob).arrayBuffer());

  const purposes = job.purposes as LinkedInPurpose[];
  let stagedRecords = cursor.stagedRecords ?? 0;
  let fileIndex = cursor.fileIndex ?? 0;

  // 2) Validering + staging, med gjenopptakelse mellom filer.
  if (!cursor.reconciled) {
    const alive = await admin.rpc("linkedin_import_heartbeat", {
      p_attempt_id: job.attempt_id,
      p_lease_owner: leaseOwner,
      p_phase: "staging",
      p_cursor: { ...cursor, fileIndex, stagedRecords },
      p_lease_seconds: LEASE_SECONDS,
    });
    if (alive.data === false) {
      await admin.rpc("linkedin_import_complete_attempt", {
        p_attempt_id: job.attempt_id,
        p_status: "cancelled",
      });
      return "cancelled";
    }

    const { validateAndStageArchive } = await import("@/lib/linkedin/stage.server");
    const outcome = await validateAndStageArchive({
      admin: admin as never,
      userId,
      importId,
      attemptId: job.attempt_id,
      archive,
      selectedPurposes: purposes,
      startFileIndex: fileIndex,
      // La rom til avstemming og opprydding innenfor invokasjonen.
      timeBudgetMs: Math.max(1_000, deadline - Date.now() - 12_000),
      onProgress: async (p) => {
        const beat = await admin.rpc("linkedin_import_heartbeat", {
          p_attempt_id: job.attempt_id,
          p_lease_owner: leaseOwner,
          p_phase: "staging",
          p_cursor: { fileIndex: p.fileIndex, stagedRecords: stagedRecords + p.stagedRecordCount },
          p_processed_files: p.fileIndex,
          p_staged_records: stagedRecords + p.stagedRecordCount,
          p_lease_seconds: LEASE_SECONDS,
        });
        return beat.data !== false;
      },
    });

    if (!outcome.ok) {
      await admin
        .from("linkedin_imports")
        .update({
          error_code: outcome.errorCode ?? "staging_failed",
          validated_at: new Date().toISOString(),
        })
        .eq("id", importId);
      await admin.rpc("linkedin_import_fail_attempt", {
        p_attempt_id: job.attempt_id,
        p_error_code: outcome.errorCode ?? "staging_failed",
        p_error_summary: "Arkivet kunne ikke leses.",
        p_retryable: false,
      });
      return "failed";
    }

    stagedRecords += outcome.stagedRecordCount;
    fileIndex = outcome.nextFileIndex;

    await admin
      .from("linkedin_imports")
      .update({
        content_manifest_hash: outcome.contentManifestHash || null,
        known_file_count: outcome.knownFileCount,
        unknown_file_count: outcome.unknownFileCount,
        excluded_file_count: outcome.excludedFileCount,
        valid_file_count: outcome.validFileCount,
        invalid_file_count: outcome.invalidFileCount,
        staged_record_count: stagedRecords,
        excluded_reason_counts: outcome.excludedReasonCounts,
        validated_at: new Date().toISOString(),
      })
      .eq("id", importId);

    if (!outcome.done) {
      const yielded = await admin.rpc("linkedin_import_yield_attempt", {
        p_attempt_id: job.attempt_id,
        p_lease_owner: leaseOwner,
        p_phase: "staging",
        p_cursor: { fileIndex, stagedRecords },
        p_processed_files: fileIndex,
        p_staged_records: stagedRecords,
      });
      return yielded.data === true ? "yielded" : "failed";
    }
  }

  // 3) Avstemming: deterministisk, skriver kun forslag.
  const beat = await admin.rpc("linkedin_import_heartbeat", {
    p_attempt_id: job.attempt_id,
    p_lease_owner: leaseOwner,
    p_phase: "reconciling",
    p_cursor: { fileIndex, stagedRecords, reconciled: true },
    p_lease_seconds: LEASE_SECONDS,
  });
  if (beat.data === false) {
    await admin.rpc("linkedin_import_complete_attempt", {
      p_attempt_id: job.attempt_id,
      p_status: "cancelled",
    });
    return "cancelled";
  }

  const { runReconciliation } = await import("@/lib/linkedin/reconciliation/engine.server");
  const result = await runReconciliation(admin as never, { userId, importId });

  if (!result.ok) {
    await admin.rpc("linkedin_import_fail_attempt", {
      p_attempt_id: job.attempt_id,
      p_error_code: result.error ?? "reconciliation_failed",
      p_error_summary: "Avstemmingen kunne ikke fullføres.",
      p_retryable: true,
    });
    return "failed";
  }

  // 3b) Nettverksavstemming v2: frosset batch for kontakter.
  const { runNetworkReconciliationV2 } = await import(
    "@/lib/linkedin/reconciliation/v2/engine.server"
  );
  const networkV2 = await runNetworkReconciliationV2(admin as never, { userId, importId });
  if (!networkV2.ok) {
    await admin.rpc("linkedin_import_fail_attempt", {
      p_attempt_id: job.attempt_id,
      p_error_code: networkV2.error ?? "network_reconciliation_v2_failed",
      p_error_summary: "Nettverksavstemming v2 kunne ikke fullføres.",
      p_retryable: true,
    });
    return "failed";
  }

  const { count: invalidFiles } = await admin
    .from("linkedin_import_files")
    .select("id", { count: "exact", head: true })
    .eq("linkedin_import_id", importId)
    .eq("status", "invalid");

  await admin.rpc("linkedin_import_complete_attempt", {
    p_attempt_id: job.attempt_id,
    p_status: (invalidFiles ?? 0) > 0 ? "partially_succeeded" : "succeeded",
    p_warning_count: invalidFiles ?? 0,
    p_staged_records: stagedRecords,
    p_reconciliation_runs: result.runs.length,
  });
  return "done";
}

export const Route = createFileRoute("/api/public/linkedin/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["LINKEDIN_IMPORT_WORKER_SECRET"];
        if (!secret) {
          console.error("[linkedin-worker] mangler LINKEDIN_IMPORT_WORKER_SECRET");
          return json({ ok: false, error: "manglende konfigurasjon" }, 503);
        }

        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
        const given = request.headers.get("x-worker-secret") ?? "";
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        const authorized =
          (given !== "" && timingSafeEqualStr(given, secret)) ||
          (bearer !== "" && serviceKey !== "" && timingSafeEqualStr(bearer, serviceKey));
        if (!authorized) return json({ ok: false, error: "ugyldig hemmelighet" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as Admin;

        // Speil hemmeligheten til nøkkelhvelvet slik at pg_cron kan lese den.
        const present = await admin.rpc("linkedin_worker_secret_present");
        if (present.data === false) {
          await admin.rpc("linkedin_worker_secret_sync", { p_secret: secret });
        }

        const action = new URL(request.url).searchParams.get("action") ?? "run";

        if (action === "reap") {
          const { data, error } = await admin.rpc("linkedin_import_reap_expired_attempts", {
            p_limit: 20,
          });
          if (error) {
            console.error("[linkedin-worker] reaper feilet", error.code);
            return json({ ok: false, error: "reaper_failed" }, 500);
          }
          return json({ ok: true, action: "reap", reaped: data ?? 0 });
        }

        const deadline = Date.now() + INVOCATION_BUDGET_MS;
        const leaseOwner = `worker-${crypto.randomUUID()}`;
        const processed: Array<{ import_id: string; result: string }> = [];

        while (Date.now() < deadline - 5_000) {
          const { data, error } = await admin.rpc("linkedin_import_claim_next_attempt", {
            p_lease_owner: leaseOwner,
            p_lease_seconds: LEASE_SECONDS,
          });
          if (error) {
            console.error("[linkedin-worker] claim feilet", error.code);
            return json({ ok: false, error: "claim_failed", processed }, 500);
          }
          const job = (Array.isArray(data) ? data[0] : data) as ClaimedAttempt | undefined;
          if (!job) break;

          try {
            const result = await processAttempt(admin, job, leaseOwner, deadline);
            processed.push({ import_id: job.import_id, result });
            if (result === "yielded") break;
          } catch (err) {
            console.error(
              "[linkedin-worker] jobb feilet",
              err instanceof Error ? err.name : "unknown",
            );
            await admin.rpc("linkedin_import_fail_attempt", {
              p_attempt_id: job.attempt_id,
              p_error_code: "worker_error",
              p_error_summary: err instanceof Error ? err.message.slice(0, 300) : "ukjent feil",
              p_retryable: isRetryable(err),
            });
            processed.push({ import_id: job.import_id, result: "failed" });
          }
        }

        return json({ ok: true, action: "run", processed });
      },
    },
  },
});
