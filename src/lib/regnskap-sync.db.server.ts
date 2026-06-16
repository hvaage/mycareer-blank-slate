/**
 * Server-only Postgres-tilgang for regnskap-sync.
 * Bruker direkte Postgres (porsager/postgres) mot SUPABASE_DB_URL,
 * fordi reg.*-schema ikke er eksponert i Data API.
 *
 * @server-only
 */

import type { RegnskapRow } from "./regnskap-sync.normalize";

// Lazy-imported postgres til Sql-type
type Sql = any;

export type SyncMode = "due" | "orgnrs" | "all-missing" | "catchup";

export type ClaimedOrg = { organisasjonsnummer: string; prevStatus: string | null };

let _sql: Sql | null = null;

export async function getSql(): Promise<Sql> {
  if (_sql) return _sql;
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL missing");
  const { default: postgres } = await import("postgres");
  _sql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    prepare: false,
    connection: { application_name: "regnskap-sync" },
  });
  return _sql;
}

export async function closeSql(): Promise<void> {
  if (_sql) {
    try { await _sql.end({ timeout: 5 }); } catch { /* ignore */ }
    _sql = null;
  }
}

/** WHERE-fragment for claimbar/due — gjenbrukes i steg A og steg C. */
const CLAIMABLE_SQL = `(
  s.organisasjonsnummer IS NULL
  OR (s.status IN ('pending','retry','due')
      AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
      AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now())
  OR (s.status = 'ok'
      AND (s.next_attempt_at <= now()
           OR s.last_success_at < now() - interval '180 days'))
  OR (s.status = 'no_regnskap'
      AND s.last_checked_at < now() - interval '90 days')
  OR (s.status = 'not_found'
      AND s.last_checked_at < now() - interval '180 days')
  OR (s.status = 'in_progress'
      AND s.last_checked_at < now() - interval '10 minutes')
)`;

/** Claimbar når raden er låst (samme regel som over, men s er NOT NULL her). */
const CLAIMABLE_LOCKED_SQL = `(
  (s.status IN ('pending','retry','due')
      AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
      AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now())
  OR (s.status = 'ok'
      AND (s.next_attempt_at <= now()
           OR s.last_success_at < now() - interval '180 days'))
  OR (s.status = 'no_regnskap'
      AND s.last_checked_at < now() - interval '90 days')
  OR (s.status = 'not_found'
      AND s.last_checked_at < now() - interval '180 days')
  OR (s.status = 'in_progress'
      AND s.last_checked_at < now() - interval '10 minutes')
)`;

/** Aktiv-lease-test (brukes for mode='orgnrs' for å skippe in-progress). */
const NOT_ACTIVE_LEASE_SQL = `NOT (
  s.status = 'in_progress' AND s.last_checked_at > now() - interval '10 minutes'
)`;

export async function selectCandidates(
  sql: Sql,
  mode: SyncMode,
  limit: number,
  staleDays: number,
  explicitOrgnrs?: string[],
): Promise<string[]> {
  if (mode === "orgnrs") {
    return (explicitOrgnrs ?? []).slice(0, limit);
  }
  const oversample = limit * 3;
  if (mode === "all-missing") {
    const rows = await sql.unsafe(
      `SELECT e.organisasjonsnummer
       FROM reg.enheter e
       LEFT JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
       WHERE coalesce(e.slettet,false)=false AND s.organisasjonsnummer IS NULL
       ORDER BY e.antall_ansatte DESC NULLS LAST
       LIMIT $1`,
      [oversample],
    );
    return (rows as any[]).map((r) => r.organisasjonsnummer);
  }
  if (mode === "catchup") {
    const rows = await sql.unsafe(
      `SELECT e.organisasjonsnummer
       FROM reg.enheter e
       JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
       WHERE coalesce(e.slettet,false)=false
         AND s.status = 'ok'
         AND s.last_success_at < now() - ($2 || ' days')::interval
         AND coalesce(s.backoff_until,'-infinity'::timestamptz) <= now()
       ORDER BY s.last_success_at ASC NULLS FIRST
       LIMIT $1`,
      [oversample, String(staleDays)],
    );
    return (rows as any[]).map((r) => r.organisasjonsnummer);
  }
  // 'due'
  const rows = await sql.unsafe(
    `SELECT e.organisasjonsnummer
     FROM reg.enheter e
     LEFT JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
     WHERE coalesce(e.slettet,false)=false AND ${CLAIMABLE_SQL}
     ORDER BY
       (s.last_checked_at IS NULL) DESC,
       s.last_checked_at ASC NULLS FIRST,
       e.antall_ansatte DESC NULLS LAST
     LIMIT $1`,
    [oversample],
  );
  return (rows as any[]).map((r) => r.organisasjonsnummer);
}

/** Steg B: INSERT manglende statusrader for kandidatene. */
export async function ensureStatusRows(sql: Sql, orgnrs: string[]): Promise<void> {
  if (orgnrs.length === 0) return;
  await sql.unsafe(
    `INSERT INTO reg.regnskap_sync_status (organisasjonsnummer, status)
     SELECT x, 'pending' FROM unnest($1::text[]) AS x
     ON CONFLICT (organisasjonsnummer) DO NOTHING`,
    [orgnrs],
  );
}

/**
 * Steg C: lås statusrader + re-sjekk claimbar regel + sett status='in_progress'.
 * Returnerer faktisk claimet liste m/prevStatus.
 *
 * For mode='orgnrs' bruker vi NOT_ACTIVE_LEASE_SQL (ingen due-vindu kreves)
 * for å tillate explicit re-sync, men fortsatt skippe aktiv lease.
 */
export async function claimOrgs(
  sql: Sql,
  orgnrs: string[],
  limit: number,
  mode: SyncMode,
): Promise<ClaimedOrg[]> {
  if (orgnrs.length === 0) return [];
  const claimableExpr = mode === "orgnrs" ? NOT_ACTIVE_LEASE_SQL : CLAIMABLE_LOCKED_SQL;

  return await sql.begin(async (tx: Sql) => {
    const locked = await tx.unsafe(
      `WITH lockable AS (
         SELECT s.organisasjonsnummer, s.status AS prev_status
         FROM reg.regnskap_sync_status s
         WHERE s.organisasjonsnummer = ANY($1::text[])
           AND ${claimableExpr}
         ORDER BY s.last_checked_at NULLS FIRST
         FOR UPDATE OF s SKIP LOCKED
         LIMIT $2
       )
       UPDATE reg.regnskap_sync_status s
       SET status = 'in_progress', last_checked_at = now(), updated_at = now()
       FROM lockable
       WHERE s.organisasjonsnummer = lockable.organisasjonsnummer
       RETURNING s.organisasjonsnummer, lockable.prev_status`,
      [orgnrs, limit],
    );
    return (locked as any[]).map((r) => ({
      organisasjonsnummer: r.organisasjonsnummer,
      prevStatus: r.prev_status ?? null,
    }));
  });
}

/** Rollback claim ved time budget. Returnerer status til prev (eller 'pending'), setter next_attempt+5m. */
export async function releaseClaim(
  sql: Sql,
  orgnr: string,
  prevStatus: string | null,
): Promise<void> {
  await sql.unsafe(
    `UPDATE reg.regnskap_sync_status
     SET status = COALESCE($2, 'pending'),
         next_attempt_at = now() + interval '5 minutes',
         updated_at = now()
     WHERE organisasjonsnummer = $1
       AND status = 'in_progress'`,
    [orgnr, prevStatus],
  );
}

const UPSERT_COLS = [
  "driftsinntekter","driftsresultat","aarsresultat",
  "sum_egenkapital","sum_gjeld","sum_eiendeler","sum_egenkapital_gjeld",
  "sum_omloepsmidler","sum_anleggsmidler","sum_driftskostnad",
  "sum_finansinntekter","sum_finanskostnad",
  "valuta","oppstillingsplan","regnskapsregler",
  "morselskap","avviklingsregnskap","smaa_foretak",
  "ikke_revidert_aarsregnskap","fravalg_revisjon",
  "brreg_regnskap_id","journalnr","regnskap_dokumenttype",
  "regnskapsperiode_fra","regnskapsperiode_til",
] as const;

/** Upsert én regnskap-rad. Returnerer true hvis insert eller faktisk endring. */
export async function upsertRegnskap(sql: Sql, row: RegnskapRow): Promise<boolean> {
  if (row.regnskapsaar === null) return false;
  const distinctClauses = UPSERT_COLS.map(
    (c) => `reg.regnskap.${c} IS DISTINCT FROM EXCLUDED.${c}`,
  ).join(" OR ");
  const setClauses = [
    ...UPSERT_COLS.map((c) => `${c} = EXCLUDED.${c}`),
    `hentet_tidspunkt = now()`,
  ].join(", ");

  const rows = await sql.unsafe(
    `INSERT INTO reg.regnskap (
       organisasjonsnummer, regnskapsaar, regnskapstype,
       brreg_regnskap_id, journalnr, regnskap_dokumenttype,
       regnskapsperiode_fra, regnskapsperiode_til,
       morselskap,
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
    [
      row.organisasjonsnummer, row.regnskapsaar, row.regnskapstype,
      row.brreg_regnskap_id, row.journalnr, row.regnskap_dokumenttype,
      row.regnskapsperiode_fra, row.regnskapsperiode_til,
      row.morselskap,
      row.driftsinntekter, row.driftsresultat, row.aarsresultat,
      row.sum_egenkapital, row.sum_gjeld, row.sum_eiendeler, row.sum_egenkapital_gjeld,
      row.sum_omloepsmidler, row.sum_anleggsmidler, row.sum_driftskostnad,
      row.sum_finansinntekter, row.sum_finanskostnad,
      row.valuta, row.avviklingsregnskap, row.oppstillingsplan,
      row.smaa_foretak, row.regnskapsregler,
      row.ikke_revidert_aarsregnskap, row.fravalg_revisjon,
    ],
  );
  return (rows as any[]).length > 0;
}

export type FinalStatus =
  | "ok" | "no_regnskap" | "not_found" | "forbidden" | "client_error" | "retry";

export type StatusPatch = {
  orgnr: string;
  status: FinalStatus;
  httpStatus: number | null;
  recordsFunnet: number;
  latestRegnskapsaar: number | null;
  availablePdfYears: number[] | null;
  lastError: string | null;
};

export async function writeFinalStatus(sql: Sql, p: StatusPatch): Promise<void> {
  if (p.status === "ok") {
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='ok', last_checked_at=now(), last_success_at=now(),
        latest_regnskapsaar=$2, records_lagret=$3, available_pdf_years=$4,
        last_http_status=$5, consecutive_failures=0,
        attempts=attempts+1, next_attempt_at=now()+interval '180 days',
        backoff_until=NULL, last_error=NULL, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.latestRegnskapsaar, p.recordsFunnet, p.availablePdfYears, p.httpStatus],
    );
  } else if (p.status === "no_regnskap") {
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='no_regnskap', last_checked_at=now(), last_success_at=now(),
        records_lagret=0, latest_regnskapsaar=NULL, available_pdf_years=$3,
        last_http_status=$2, consecutive_failures=0,
        attempts=attempts+1, next_attempt_at=now()+interval '90 days',
        backoff_until=NULL, last_error=NULL, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.httpStatus, p.availablePdfYears],
    );
  } else if (p.status === "not_found") {
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='not_found', last_checked_at=now(), last_http_status=$2,
        consecutive_failures=0, attempts=attempts+1,
        next_attempt_at=now()+interval '180 days', backoff_until=NULL,
        last_error=NULL, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.httpStatus],
    );
  } else if (p.status === "forbidden") {
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='forbidden', last_checked_at=now(), last_http_status=$2,
        attempts=attempts+1, backoff_until=now()+interval '7 days',
        next_attempt_at=now()+interval '7 days',
        last_error=$3, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.httpStatus, p.lastError],
    );
  } else if (p.status === "client_error") {
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='client_error', last_checked_at=now(), last_http_status=$2,
        attempts=attempts+1, backoff_until=now()+interval '7 days',
        next_attempt_at=now()+interval '7 days',
        last_error=$3, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.httpStatus, p.lastError],
    );
  } else {
    // retry
    await sql.unsafe(
      `UPDATE reg.regnskap_sync_status SET
        status='retry', last_checked_at=now(), last_http_status=$2,
        attempts=attempts+1, consecutive_failures=consecutive_failures+1,
        backoff_until = now() + LEAST(interval '2 hours',
                                      interval '5 minutes' * power(2, consecutive_failures)),
        next_attempt_at = now() + LEAST(interval '2 hours',
                                        interval '5 minutes' * power(2, consecutive_failures)),
        last_error=$3, updated_at=now()
       WHERE organisasjonsnummer=$1`,
      [p.orgnr, p.httpStatus, p.lastError],
    );
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

export async function startRun(sql: Sql, i: RunStartInput): Promise<number> {
  const rows = await sql.unsafe(
    `INSERT INTO reg.regnskap_sync_runs (
       scope, mode, dry_run, max_orgs, stale_days,
       time_budget_ms, rps_setting, meta, status, payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'running','{}'::jsonb)
     RETURNING id`,
    [i.mode, i.mode, i.dryRun, i.limit, i.staleDays, i.timeBudgetMs, i.rps, JSON.stringify(i.meta)],
  );
  return Number((rows as any[])[0].id);
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

export async function finishRun(sql: Sql, i: RunFinishInput): Promise<void> {
  await sql.unsafe(
    `UPDATE reg.regnskap_sync_runs SET
      status=$2, finished_at=now(), duration_ms=$3,
      selected_count=$4, checked_count=$5,
      with_regnskap_count=$6, no_regnskap_count=$7,
      failed_count=$8, skipped_count=$9, records_lagret=$10,
      http_429_count=$11, http_503_count=$12, retry_count=$13,
      last_error=$14, meta = meta || $15::jsonb
     WHERE id=$1`,
    [
      i.runId, i.status, i.durationMs,
      i.selected, i.checked, i.withRegnskap, i.noRegnskap,
      i.failed, i.skipped, i.recordsLagret,
      i.http429, i.http503, i.retries,
      i.lastError, JSON.stringify(i.extraMeta),
    ],
  );
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

export async function insertRunItems(sql: Sql, items: RunItem[]): Promise<void> {
  if (items.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const values: any[] = [];
    const placeholders: string[] = [];
    chunk.forEach((it, idx) => {
      const o = idx * 7;
      placeholders.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`);
      values.push(it.runId, it.orgnr, it.status, it.httpStatus, it.attempts, it.latencyMs, it.error);
    });
    await sql.unsafe(
      `INSERT INTO reg.regnskap_sync_run_items
        (run_id, organisasjonsnummer, status, http_status, attempts, latency_ms, error)
       VALUES ${placeholders.join(",")}`,
      values,
    );
  }
}
