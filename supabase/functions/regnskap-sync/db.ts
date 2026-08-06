// Postgres-tilgang for regnskap-sync Edge Function.
// Bruker deno-postgres mot SUPABASE_DB_URL. reg.* ikke eksponert i Data API.

import {
  Pool,
  type PoolClient,
} from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import type { RegnskapRow } from "./normalize.ts";

export type SyncMode = "due" | "orgnrs" | "all-missing" | "catchup";
export type ClaimedOrg = {
  organisasjonsnummer: string;
  prevStatus: string | null;
};
export type FinalStatus =
  | "ok"
  | "no_regnskap"
  | "not_found"
  | "forbidden"
  | "client_error"
  | "unsupported_regnskap_api"
  | "retry";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("SUPABASE_DB_URL missing");
  _pool = new Pool(url, 1, true);
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    try {
      await _pool.end();
    } catch { /* */ }
    _pool = null;
  }
}

export async function withClient<T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const CANDIDATE_STATEMENT_TIMEOUT_MS = 8_000;

async function withStatementTimeout<T>(
  c: PoolClient,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  await c.queryObject(`SET statement_timeout = '${timeoutMs}ms'`);
  try {
    return await fn();
  } finally {
    try {
      await c.queryObject("RESET statement_timeout");
    } catch { /* keep original error */ }
  }
}

const REGNSKAP_SYNC_LOCK_KEY_SQL =
  "hashtextextended('regnskap-sync:global', 0)";

export async function tryAcquireRegnskapSyncLock(
  c: PoolClient,
): Promise<boolean> {
  const r = await c.queryObject<{ acquired: boolean }>({
    text:
      `SELECT pg_try_advisory_lock(${REGNSKAP_SYNC_LOCK_KEY_SQL}) AS acquired`,
  });
  return r.rows[0]?.acquired === true;
}

export async function releaseRegnskapSyncLock(c: PoolClient): Promise<void> {
  await c.queryObject({
    text: `SELECT pg_advisory_unlock(${REGNSKAP_SYNC_LOCK_KEY_SQL})`,
  });
}

const CLAIMABLE_LOCKED_SQL = `(
  (s.status IN ('pending','retry','due')
      AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
      AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now())
  OR (s.status = 'ok' AND (s.next_attempt_at <= now() OR s.last_success_at < now() - interval '180 days'))
  OR (s.status = 'no_regnskap' AND s.last_checked_at < now() - interval '90 days')
  OR (s.status = 'not_found' AND s.last_checked_at < now() - interval '180 days')
  OR (s.status = 'in_progress' AND s.last_checked_at < now() - interval '10 minutes')
)`;

const NOT_ACTIVE_LEASE_SQL =
  `NOT (s.status = 'in_progress' AND s.last_checked_at > now() - interval '10 minutes')`;

export function retryBackoffMinutes(
  httpStatus: number | null,
  previousConsecutiveFailures: number | null | undefined,
): number {
  const failures = Math.max(
    0,
    Math.trunc(Number(previousConsecutiveFailures ?? 0)),
  );
  if (httpStatus === 500) {
    if (failures >= 2) return 7 * 24 * 60;
    if (failures >= 1) return 24 * 60;
    return 6 * 60;
  }
  return Math.min(120, 5 * Math.pow(2, Math.min(failures, 5)));
}

type RegnskapApiSupportInput = {
  organisasjonsformKode?: string | null;
  organisasjonsformBeskrivelse?: string | null;
  naeringskode1Kode?: string | null;
  naeringskode1Beskrivelse?: string | null;
};

const UNSUPPORTED_REGNSKAP_ORG_FORMS: Record<string, string> = {
  SPA: "bank/sparebank",
  GFS: "insurance company",
  PK: "pension fund",
};

const UNSUPPORTED_REGNSKAP_NACE_PREFIXES: Array<{
  prefix: string;
  reason: string;
}> = [
  { prefix: "64.190", reason: "banking and credit institution" },
  { prefix: "65.1", reason: "insurance" },
  { prefix: "65.2", reason: "reinsurance" },
  { prefix: "65.3", reason: "pension fund" },
];

export function unsupportedRegnskapApiReason(
  input: RegnskapApiSupportInput,
): string | null {
  const orgForm = (input.organisasjonsformKode ?? "").trim().toUpperCase();
  const orgFormReason = UNSUPPORTED_REGNSKAP_ORG_FORMS[orgForm];
  if (orgFormReason) {
    return [
      "unsupported_by_brreg_open_regnskap_api",
      orgFormReason,
      `organisasjonsform=${orgForm}`,
      input.organisasjonsformBeskrivelse ?? null,
    ].filter(Boolean).join("; ");
  }

  const nace = (input.naeringskode1Kode ?? "").trim();
  const naceMatch = UNSUPPORTED_REGNSKAP_NACE_PREFIXES.find((entry) =>
    nace.startsWith(entry.prefix)
  );
  if (naceMatch) {
    return [
      "unsupported_by_brreg_open_regnskap_api",
      naceMatch.reason,
      `naeringskode1=${nace}`,
      input.naeringskode1Beskrivelse ?? null,
    ].filter(Boolean).join("; ");
  }

  return null;
}

export async function unsupportedRegnskapApiReasonForOrg(
  c: PoolClient,
  orgnr: string,
): Promise<string | null> {
  const r = await c.queryObject<{
    organisasjonsform_kode: string | null;
    organisasjonsform_beskrivelse: string | null;
    naeringskode1_kode: string | null;
    naeringskode1_beskrivelse: string | null;
  }>({
    text: `SELECT
             organisasjonsform_kode,
             organisasjonsform_beskrivelse,
             naeringskode1_kode,
             naeringskode1_beskrivelse
           FROM reg.enheter
           WHERE organisasjonsnummer = $1
           LIMIT 1`,
    args: [orgnr],
  });
  const row = r.rows[0];
  if (!row) return null;
  return unsupportedRegnskapApiReason({
    organisasjonsformKode: row.organisasjonsform_kode,
    organisasjonsformBeskrivelse: row.organisasjonsform_beskrivelse,
    naeringskode1Kode: row.naeringskode1_kode,
    naeringskode1Beskrivelse: row.naeringskode1_beskrivelse,
  });
}

async function getConsecutiveFailures(
  c: PoolClient,
  orgnr: string,
): Promise<number> {
  const r = await c.queryObject<{ consecutive_failures: number | null }>({
    text:
      `SELECT consecutive_failures FROM reg.regnskap_sync_status WHERE organisasjonsnummer = $1`,
    args: [orgnr],
  });
  return Number(r.rows[0]?.consecutive_failures ?? 0);
}

export async function selectCandidates(
  c: PoolClient,
  mode: SyncMode,
  limit: number,
  staleDays: number,
  explicitOrgnrs?: string[],
): Promise<string[]> {
  if (mode === "orgnrs") return (explicitOrgnrs ?? []).slice(0, limit);
  const oversample = limit * 3;
  if (mode === "all-missing") {
    const r = await c.queryObject<{ organisasjonsnummer: string }>({
      text: `SELECT e.organisasjonsnummer FROM reg.enheter e
             LEFT JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
             WHERE coalesce(e.slettet,false)=false AND s.organisasjonsnummer IS NULL
             ORDER BY e.antall_ansatte DESC NULLS LAST LIMIT $1`,
      args: [oversample],
    });
    return r.rows.map((x) => x.organisasjonsnummer);
  }
  if (mode === "catchup") {
    const r = await c.queryObject<{ organisasjonsnummer: string }>({
      text: `SELECT e.organisasjonsnummer FROM reg.enheter e
             JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
             WHERE coalesce(e.slettet,false)=false AND s.status='ok'
               AND s.last_success_at < now() - ($2 || ' days')::interval
               AND coalesce(s.backoff_until,'-infinity'::timestamptz) <= now()
             ORDER BY s.last_success_at ASC NULLS FIRST LIMIT $1`,
      args: [oversample, String(staleDays)],
    });
    return r.rows.map((x) => x.organisasjonsnummer);
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const appendRows = (rows: Array<{ organisasjonsnummer: string }>) => {
    for (const row of rows) {
      if (candidates.length >= oversample) break;
      if (!seen.has(row.organisasjonsnummer)) {
        seen.add(row.organisasjonsnummer);
        candidates.push(row.organisasjonsnummer);
      }
    }
  };
  const remaining = () => Math.max(0, oversample - candidates.length);
  const runBranch = async (
    label: string,
    text: string,
    required = false,
  ) => {
    if (remaining() === 0) return;
    try {
      const r = await withStatementTimeout(
        c,
        CANDIDATE_STATEMENT_TIMEOUT_MS,
        () =>
          c.queryObject<{ organisasjonsnummer: string }>({
            text,
            args: [remaining()],
          }),
      );
      appendRows(r.rows);
    } catch (e) {
      const anyE = e as any;
      const code = anyE?.code || anyE?.fields?.code || anyE?.sqlState;
      if (required || code !== "57014") throw e;
      console.warn(
        `[regnskap-sync] optional candidate branch timed out: ${label}`,
      );
    }
  };

  await runBranch(
    "ready_pending_retry_due",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status IN ('pending','retry','due')
       AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
       AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now()
     ORDER BY coalesce(s.next_attempt_at, '-infinity'::timestamptz), s.last_checked_at ASC NULLS FIRST
     LIMIT $1`,
    true,
  );
  await runBranch(
    "stale_in_progress",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status = 'in_progress'
       AND s.last_checked_at < now() - interval '10 minutes'
     ORDER BY s.last_checked_at ASC NULLS FIRST
     LIMIT $1`,
  );
  await runBranch(
    "due_no_regnskap",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status = 'no_regnskap'
       AND s.last_checked_at < now() - interval '90 days'
     ORDER BY s.last_checked_at ASC NULLS FIRST
     LIMIT $1`,
  );
  await runBranch(
    "due_not_found",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status = 'not_found'
       AND s.last_checked_at < now() - interval '180 days'
     ORDER BY s.last_checked_at ASC NULLS FIRST
     LIMIT $1`,
  );
  await runBranch(
    "ok_next_attempt",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status = 'ok'
       AND s.next_attempt_at <= now()
     ORDER BY s.next_attempt_at, s.last_checked_at ASC NULLS FIRST
     LIMIT $1`,
  );
  await runBranch(
    "ok_last_success",
    `SELECT s.organisasjonsnummer
     FROM reg.regnskap_sync_status s
     JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false
       AND s.status = 'ok'
       AND s.last_success_at < now() - interval '180 days'
     ORDER BY s.last_success_at ASC NULLS FIRST
     LIMIT $1`,
  );

  return candidates;
}

export async function ensureStatusRows(
  c: PoolClient,
  orgnrs: string[],
): Promise<void> {
  if (orgnrs.length === 0) return;
  await c.queryObject({
    text: `INSERT INTO reg.regnskap_sync_status (organisasjonsnummer, status)
           SELECT x, 'pending' FROM unnest($1::text[]) AS x
           ON CONFLICT (organisasjonsnummer) DO NOTHING`,
    args: [orgnrs],
  });
}

export async function claimOrgs(
  c: PoolClient,
  orgnrs: string[],
  limit: number,
  mode: SyncMode,
): Promise<ClaimedOrg[]> {
  if (orgnrs.length === 0) return [];
  const claimableExpr = mode === "orgnrs"
    ? NOT_ACTIVE_LEASE_SQL
    : CLAIMABLE_LOCKED_SQL;
  await c.queryObject("BEGIN");
  try {
    const r = await c.queryObject<
      { organisasjonsnummer: string; prev_status: string | null }
    >({
      text: `WITH lockable AS (
               SELECT s.organisasjonsnummer, s.status AS prev_status
               FROM reg.regnskap_sync_status s
               WHERE s.organisasjonsnummer = ANY($1::text[])
                 AND ${claimableExpr}
               ORDER BY s.last_checked_at NULLS FIRST
               FOR UPDATE OF s SKIP LOCKED
               LIMIT $2
             )
             UPDATE reg.regnskap_sync_status s
             SET status='in_progress', last_checked_at=now(), updated_at=now()
             FROM lockable
             WHERE s.organisasjonsnummer = lockable.organisasjonsnummer
             RETURNING s.organisasjonsnummer, lockable.prev_status`,
      args: [orgnrs, limit],
    });
    await c.queryObject("COMMIT");
    return r.rows.map((x) => ({
      organisasjonsnummer: x.organisasjonsnummer,
      prevStatus: x.prev_status ?? null,
    }));
  } catch (e) {
    try {
      await c.queryObject("ROLLBACK");
    } catch { /* */ }
    throw e;
  }
}

export async function releaseClaim(
  c: PoolClient,
  orgnr: string,
  prevStatus: string | null,
): Promise<void> {
  await c.queryObject({
    text: `UPDATE reg.regnskap_sync_status
           SET status = CASE WHEN $2 = 'in_progress' THEN 'retry' ELSE COALESCE($2, 'pending') END,
               next_attempt_at = now() + interval '5 minutes',
               backoff_until = CASE
                 WHEN $2 = 'in_progress' THEN now() + interval '5 minutes'
                 ELSE backoff_until
               END,
               last_error = CASE
                 WHEN $2 = 'in_progress' THEN COALESCE(last_error, 'recovered stale in_progress claim during release')
                 ELSE last_error
               END,
               updated_at = now()
           WHERE organisasjonsnummer = $1 AND status = 'in_progress'`,
    args: [orgnr, prevStatus],
  });
}

const UPSERT_COLS = [
  "driftsinntekter",
  "driftsresultat",
  "aarsresultat",
  "sum_egenkapital",
  "sum_gjeld",
  "sum_eiendeler",
  "sum_egenkapital_gjeld",
  "sum_omloepsmidler",
  "sum_anleggsmidler",
  "sum_driftskostnad",
  "sum_finansinntekter",
  "sum_finanskostnad",
  "valuta",
  "oppstillingsplan",
  "regnskapsregler",
  "morselskap",
  "avviklingsregnskap",
  "smaa_foretak",
  "ikke_revidert_aarsregnskap",
  "fravalg_revisjon",
  "brreg_regnskap_id",
  "journalnr",
  "regnskap_dokumenttype",
  "regnskapsperiode_fra",
  "regnskapsperiode_til",
] as const;

export async function upsertRegnskap(
  c: PoolClient,
  row: RegnskapRow,
): Promise<boolean> {
  if (row.regnskapsaar === null) return false;
  const distinctClauses = UPSERT_COLS.map((col) =>
    `reg.regnskap.${col} IS DISTINCT FROM EXCLUDED.${col}`
  ).join(" OR ");
  const setClauses = [
    ...UPSERT_COLS.map((col) => `${col} = EXCLUDED.${col}`),
    `hentet_tidspunkt = now()`,
  ].join(", ");
  const r = await c.queryObject<{ id: number }>({
    text: `INSERT INTO reg.regnskap (
             organisasjonsnummer, regnskapsaar, regnskapstype,
             brreg_regnskap_id, journalnr, regnskap_dokumenttype,
             regnskapsperiode_fra, regnskapsperiode_til, morselskap,
             driftsinntekter, driftsresultat, aarsresultat,
             sum_egenkapital, sum_gjeld, sum_eiendeler, sum_egenkapital_gjeld,
             sum_omloepsmidler, sum_anleggsmidler, sum_driftskostnad,
             sum_finansinntekter, sum_finanskostnad,
             valuta, avviklingsregnskap, oppstillingsplan,
             smaa_foretak, regnskapsregler,
             ikke_revidert_aarsregnskap, fravalg_revisjon,
             raw_data, hentet_tidspunkt
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NULL,now()
           )
           ON CONFLICT (organisasjonsnummer, regnskapsaar, regnskapstype) DO UPDATE
           SET ${setClauses}
           WHERE ${distinctClauses}
           RETURNING id`,
    args: [
      row.organisasjonsnummer,
      row.regnskapsaar,
      row.regnskapstype,
      row.brreg_regnskap_id,
      row.journalnr,
      row.regnskap_dokumenttype,
      row.regnskapsperiode_fra,
      row.regnskapsperiode_til,
      row.morselskap,
      row.driftsinntekter,
      row.driftsresultat,
      row.aarsresultat,
      row.sum_egenkapital,
      row.sum_gjeld,
      row.sum_eiendeler,
      row.sum_egenkapital_gjeld,
      row.sum_omloepsmidler,
      row.sum_anleggsmidler,
      row.sum_driftskostnad,
      row.sum_finansinntekter,
      row.sum_finanskostnad,
      row.valuta,
      row.avviklingsregnskap,
      row.oppstillingsplan,
      row.smaa_foretak,
      row.regnskapsregler,
      row.ikke_revidert_aarsregnskap,
      row.fravalg_revisjon,
    ],
  });
  return r.rows.length > 0;
}

export type StatusPatch = {
  orgnr: string;
  status: FinalStatus;
  httpStatus: number | null;
  recordsFunnet: number;
  latestRegnskapsaar: number | null;
  availablePdfYears: number[] | null;
  lastError: string | null;
};

export async function writeFinalStatus(
  c: PoolClient,
  p: StatusPatch,
): Promise<void> {
  if (p.status === "ok") {
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status='ok', last_checked_at=now(), last_success_at=now(),
              latest_regnskapsaar=$2, records_lagret=$3, available_pdf_years=$4,
              last_http_status=$5, consecutive_failures=0,
              attempts=attempts+1, next_attempt_at=now()+interval '180 days',
              backoff_until=NULL, last_error=NULL, updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [
        p.orgnr,
        p.latestRegnskapsaar,
        p.recordsFunnet,
        p.availablePdfYears,
        p.httpStatus,
      ],
    });
  } else if (p.status === "no_regnskap") {
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status='no_regnskap', last_checked_at=now(), last_success_at=now(),
              records_lagret=0, latest_regnskapsaar=NULL, available_pdf_years=$3,
              last_http_status=$2, consecutive_failures=0,
              attempts=attempts+1, next_attempt_at=now()+interval '90 days',
              backoff_until=NULL, last_error=NULL, updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [p.orgnr, p.httpStatus, p.availablePdfYears],
    });
  } else if (p.status === "not_found") {
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status='not_found', last_checked_at=now(), last_http_status=$2,
              consecutive_failures=0, attempts=attempts+1,
              next_attempt_at=now()+interval '180 days', backoff_until=NULL,
              last_error=NULL, updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [p.orgnr, p.httpStatus],
    });
  } else if (p.status === "forbidden" || p.status === "client_error") {
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status=$4, last_checked_at=now(), last_http_status=$2,
              attempts=attempts+1, backoff_until=now()+interval '7 days',
              next_attempt_at=now()+interval '7 days',
              last_error=$3, updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [p.orgnr, p.httpStatus, p.lastError, p.status],
    });
  } else if (p.status === "unsupported_regnskap_api") {
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status='unsupported_regnskap_api',
              last_checked_at=now(),
              last_http_status=$2,
              attempts=attempts+1,
              consecutive_failures=COALESCE(consecutive_failures, 0)+1,
              records_lagret=0,
              latest_regnskapsaar=NULL,
              available_pdf_years=NULL,
              backoff_until=now()+interval '365 days',
              next_attempt_at=now()+interval '365 days',
              last_error=$3,
              updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [p.orgnr, p.httpStatus, p.lastError],
    });
  } else {
    const backoffMinutes = retryBackoffMinutes(
      p.httpStatus,
      await getConsecutiveFailures(c, p.orgnr),
    );
    await c.queryObject({
      text: `UPDATE reg.regnskap_sync_status SET
              status='retry', last_checked_at=now(), last_http_status=$2,
              attempts=attempts+1, consecutive_failures=COALESCE(consecutive_failures, 0)+1,
              backoff_until = now() + ($4::integer * interval '1 minute'),
              next_attempt_at = now() + ($4::integer * interval '1 minute'),
              last_error=$3, updated_at=now()
             WHERE organisasjonsnummer=$1`,
      args: [p.orgnr, p.httpStatus, p.lastError, backoffMinutes],
    });
  }
}

export type RunStartInput = {
  mode: SyncMode;
  dryRun: boolean;
  limit: number;
  staleDays: number;
  timeBudgetMs: number;
  rps: number;
  meta: Record<string, unknown>;
};

export async function startRun(
  c: PoolClient,
  i: RunStartInput,
): Promise<number> {
  const r = await c.queryObject<{ id: bigint | number }>({
    text: `INSERT INTO reg.regnskap_sync_runs (
             scope, mode, dry_run, max_orgs, stale_days,
             time_budget_ms, rps_setting, meta, status, payload
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'running','{}'::jsonb)
           RETURNING id`,
    args: [
      i.mode,
      i.mode,
      i.dryRun,
      i.limit,
      i.staleDays,
      i.timeBudgetMs,
      i.rps,
      JSON.stringify(i.meta),
    ],
  });
  return Number(r.rows[0].id);
}

export type RunFinishInput = {
  runId: number;
  status: "ok" | "partial" | "failed";
  durationMs: number;
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
  lastError: string | null;
  extraMeta: Record<string, unknown>;
};

export async function finishRun(
  c: PoolClient,
  i: RunFinishInput,
): Promise<void> {
  await c.queryObject({
    text: `UPDATE reg.regnskap_sync_runs SET
            status=$2, finished_at=now(), duration_ms=$3,
            selected_count=$4, checked_count=$5,
            with_regnskap_count=$6, no_regnskap_count=$7,
            failed_count=$8, skipped_count=$9, records_lagret=$10,
            http_429_count=$11, http_503_count=$12, retry_count=$13,
            last_error=$14, meta = meta || $15::jsonb
           WHERE id=$1`,
    args: [
      i.runId,
      i.status,
      i.durationMs,
      i.selected,
      i.checked,
      i.withRegnskap,
      i.noRegnskap,
      i.failed,
      i.skipped,
      i.recordsLagret,
      i.http429,
      i.http503,
      i.retries,
      i.lastError,
      JSON.stringify(i.extraMeta),
    ],
  });
}

export type RunItem = {
  runId: number;
  orgnr: string;
  status: string;
  httpStatus: number | null;
  attempts: number;
  latencyMs: number | null;
  error: string | null;
};

export async function insertRunItems(
  c: PoolClient,
  items: RunItem[],
): Promise<void> {
  if (items.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const values: any[] = [];
    const placeholders: string[] = [];
    chunk.forEach((it, idx) => {
      const o = idx * 7;
      placeholders.push(
        `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${
          o + 7
        })`,
      );
      values.push(
        it.runId,
        it.orgnr,
        it.status,
        it.httpStatus,
        it.attempts,
        it.latencyMs,
        it.error,
      );
    });
    await c.queryObject({
      text: `INSERT INTO reg.regnskap_sync_run_items
              (run_id, organisasjonsnummer, status, http_status, attempts, latency_ms, error)
             VALUES ${placeholders.join(",")}`,
      args: values,
    });
  }
}

// ===== Status-helpers for op:'status'. Leses kun via SUPABASE_DB_URL i Edge Function. =====

export type RecentRun = {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  mode: string | null;
  scope: string | null;
  dry_run: boolean | null;
  duration_ms: number | null;
  selected_count: number | null;
  checked_count: number | null;
  with_regnskap_count: number | null;
  no_regnskap_count: number | null;
  failed_count: number | null;
  skipped_count: number | null;
  records_lagret: number | null;
  http_429_count: number | null;
  http_503_count: number | null;
  retry_count: number | null;
  last_error: string | null;
  meta: Record<string, unknown> | null;
};

export async function getRecentRuns(
  c: PoolClient,
  limit = 5,
): Promise<RecentRun[]> {
  const r = await c.queryObject<RecentRun & { id: bigint | number }>({
    text:
      `SELECT id, started_at, finished_at, status, mode, scope, dry_run, duration_ms,
                  selected_count, checked_count, with_regnskap_count, no_regnskap_count,
                  failed_count, skipped_count, records_lagret,
                  http_429_count, http_503_count, retry_count, last_error, meta
             FROM reg.regnskap_sync_runs
            ORDER BY started_at DESC NULLS LAST, id DESC
            LIMIT $1`,
    args: [limit],
  });
  return r.rows.map((x) => ({ ...x, id: Number(x.id) }));
}

export type StatusSummary = {
  byStatus: Record<string, number>;
  total: number;
  missing: number; // ingen rad i sync_status (kandidat for first-run)
  neverSucceeded: number; // last_success_at IS NULL
  stale: number; // status='ok' med last_success_at < now() - staleDays
  inProgressStuck: number; // status='in_progress' og lease utløpt (>10 min)
};

export async function getStatusSummary(
  c: PoolClient,
  staleDays = 180,
): Promise<StatusSummary> {
  const byStatusRes = await c.queryObject<
    { status: string; n: bigint | number }
  >({
    text:
      `SELECT status, COUNT(*)::bigint AS n FROM reg.regnskap_sync_status GROUP BY status`,
  });
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of byStatusRes.rows) {
    const n = Number(row.n);
    byStatus[row.status ?? "unknown"] = n;
    total += n;
  }
  const missingRes = await c.queryObject<{ n: bigint | number }>({
    text: `SELECT COUNT(*)::bigint AS n
             FROM reg.enheter e
             LEFT JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
            WHERE coalesce(e.slettet,false)=false AND s.organisasjonsnummer IS NULL`,
  });
  const neverRes = await c.queryObject<{ n: bigint | number }>({
    text:
      `SELECT COUNT(*)::bigint AS n FROM reg.regnskap_sync_status WHERE last_success_at IS NULL`,
  });
  const staleRes = await c.queryObject<{ n: bigint | number }>({
    text: `SELECT COUNT(*)::bigint AS n FROM reg.regnskap_sync_status
            WHERE status = 'ok' AND last_success_at < now() - ($1 || ' days')::interval`,
    args: [String(staleDays)],
  });
  const stuckRes = await c.queryObject<{ n: bigint | number }>({
    text: `SELECT COUNT(*)::bigint AS n FROM reg.regnskap_sync_status
            WHERE status = 'in_progress' AND last_checked_at < now() - interval '10 minutes'`,
  });
  return {
    byStatus,
    total,
    missing: Number(missingRes.rows[0]?.n ?? 0),
    neverSucceeded: Number(neverRes.rows[0]?.n ?? 0),
    stale: Number(staleRes.rows[0]?.n ?? 0),
    inProgressStuck: Number(stuckRes.rows[0]?.n ?? 0),
  };
}

// ===== Post-batch helpers (M5.4). Aldri throw — runneren håndterer logging. =====

export type PostStepResult = {
  ok: boolean;
  durationMs: number;
  mode?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

/** Patcher meta JSONB på en eksisterende run uten å endre status. */
export async function patchRunMeta(
  c: PoolClient,
  runId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await c.queryObject({
    text:
      `UPDATE reg.regnskap_sync_runs SET meta = meta || $2::jsonb WHERE id = $1`,
    args: [runId, JSON.stringify(patch)],
  });
}

/** Sjekker om reg.regnskap_siste_per_org finnes og hvilken relkind den har. */
async function getRelkind(
  c: PoolClient,
  qualified: string,
): Promise<string | null> {
  try {
    const r = await c.queryObject<{ relkind: string }>({
      text: `SELECT relkind::text FROM pg_class WHERE oid = $1::regclass`,
      args: [qualified],
    });
    return r.rows[0]?.relkind ?? null;
  } catch {
    return null;
  }
}

/**
 * REFRESH av reg.regnskap_siste_per_org hvis den er materialized view.
 * Prøver CONCURRENTLY først, faller tilbake til plain. Aldri throw.
 */
export async function refreshLatestRegnskapMV(
  c: PoolClient,
): Promise<PostStepResult> {
  const t0 = Date.now();
  const kind = await getRelkind(c, "reg.regnskap_siste_per_org");
  if (kind !== "m") {
    return {
      ok: true,
      durationMs: Date.now() - t0,
      skipped: true,
      reason: kind ? `relkind=${kind}` : "not_found",
    };
  }
  try {
    await c.queryObject(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY reg.regnskap_siste_per_org`,
    );
    return { ok: true, durationMs: Date.now() - t0, mode: "concurrent" };
  } catch (e1) {
    try {
      await c.queryObject(
        `REFRESH MATERIALIZED VIEW reg.regnskap_siste_per_org`,
      );
      return {
        ok: true,
        durationMs: Date.now() - t0,
        mode: "plain",
        reason: e1 instanceof Error
          ? e1.message.slice(0, 200)
          : String(e1).slice(0, 200),
      };
    } catch (e2) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        mode: "failed",
        error: e2 instanceof Error
          ? e2.message.slice(0, 300)
          : String(e2).slice(0, 300),
      };
    }
  }
}

/**
 * ANALYZE av berørte tabeller. reg.enheter kun ved store batcher.
 * MV analyseres hvis materialisert. Aldri throw.
 */
export async function analyzeRegnskapTables(
  c: PoolClient,
  opts: { includeEnheter: boolean },
): Promise<PostStepResult & { tables: string[] }> {
  const t0 = Date.now();
  const tables: string[] = ["reg.regnskap", "reg.regnskap_sync_status"];
  if (opts.includeEnheter) tables.push("reg.enheter");
  const mvKind = await getRelkind(c, "reg.regnskap_siste_per_org");
  if (mvKind === "m") tables.push("reg.regnskap_siste_per_org");
  const errors: string[] = [];
  for (const t of tables) {
    try {
      await c.queryObject(`ANALYZE ${t}`);
    } catch (e) {
      errors.push(
        `${t}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      );
    }
  }
  return {
    ok: errors.length === 0,
    durationMs: Date.now() - t0,
    tables,
    ...(errors.length ? { error: errors.join(" | ").slice(0, 400) } : {}),
  };
}
