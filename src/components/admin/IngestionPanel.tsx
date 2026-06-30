import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getAdminIngestionStatus,
  type AdminIngestionStatus,
} from "@/lib/admin-ingestion.functions";

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("no-NO");
  } catch {
    return dt;
  }
}
function fmtDate(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleDateString("no-NO");
  } catch {
    return dt;
  }
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("no-NO");
}
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function Card({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
function Big({
  children,
  alert,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={`text-2xl font-semibold ${alert ? "text-destructive" : "text-foreground"}`}
    >
      {children}
    </div>
  );
}
function Muted({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-xs text-muted-foreground ${className}`}>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {children}
    </div>
  );
}

export function IngestionPanel() {
  const fetchStatus = useServerFn(getAdminIngestionStatus);
  const { data, isLoading, error, refetch, isFetching } = useQuery<
    AdminIngestionStatus,
    Error
  >({
    queryKey: ["admin-ingestion-status"],
    queryFn: () => fetchStatus(),
  });

  const errMessage = error ? error.message : null;
  const forbidden =
    errMessage != null && /forbidden|unauthor|permission/i.test(errMessage);

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Datainntak</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only status for register- og jobbannonse-nedlastinger
            (Brønnøysund og NAV).
          </p>
          {data && (
            <p className="text-xs text-muted-foreground mt-2">
              Sist oppdatert: {fmt(data.generated_at)} · Vindu:{" "}
              {fmtDate(data.window?.from_date)} →{" "}
              {fmtDate(data.window?.to_date)} ({data.window?.days} dager)
            </p>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? "Oppdaterer…" : "Oppdater"}
        </button>
      </div>

      {isLoading && <p className="mt-8 text-muted-foreground">Laster…</p>}
      {forbidden && (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Du mangler adminrettighet for å se denne siden.
        </div>
      )}
      {errMessage && !forbidden && (
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {errMessage}
        </div>
      )}

      {data && !errMessage && (
        <>
          <EnhetsregisterSection data={data} />
          <RegnskapsregisterSection data={data} />
          <NavSection data={data} />
        </>
      )}
    </div>
  );
}

function EnhetsregisterSection({ data }: { data: AdminIngestionStatus }) {
  const e = data.brreg?.enhetsregisteret ?? {};
  const remainingKnown = e.remaining_upstream != null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">
        Brønnøysund · Enhetsregisteret
      </h2>
      <Grid>
        <Card label="Nedlastede enheter">
          <Big>{fmtNum(e.downloaded_total)}</Big>
        </Card>
        <Card label="Aktive i lokalt speil">
          <Big>{fmtNum(e.downloaded_active)}</Big>
        </Card>
        <Card label="Slettede/utgåtte">
          <Big>{fmtNum(e.downloaded_deleted)}</Big>
        </Card>
        <Card label="Gjenstår">
          <Big>{remainingKnown ? fmtNum(e.remaining_upstream) : "Ukjent"}</Big>
          {!remainingKnown && e.remaining_reason && (
            <Muted className="mt-1">{e.remaining_reason}</Muted>
          )}
        </Card>
      </Grid>
      <Grid>
        <Card label="Siste hentet">
          <div className="text-sm font-mono">{fmt(e.latest_fetched_at)}</div>
        </Card>
        <Card label="Siste oppdatert">
          <div className="text-sm font-mono">{fmt(e.latest_updated_at)}</div>
        </Card>
      </Grid>
    </section>
  );
}

function RegnskapsregisterSection({ data }: { data: AdminIngestionStatus }) {
  const r = data.brreg?.regnskapsregisteret ?? {};
  const s = data.brreg?.regnskap_sync ?? {};
  const lr = s.latest_run ?? null;
  const byStatus = s.by_status ?? {};
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">
        Brønnøysund · Regnskapsregisteret
      </h2>
      <Grid>
        <Card label="Selskap med min. 1 års regnskap">
          <Big>{fmtNum(r.companies_with_min_1_year)}</Big>
        </Card>
        <Card label="Koblet til enhetsspeil">
          <Big>{fmtNum(r.companies_with_min_1_year_in_enhetsregisteret)}</Big>
        </Card>
        <Card label="Regnskapsrader">
          <Big>{fmtNum(r.rows_total)}</Big>
        </Card>
        <Card label="Gjenstår mot lokalt enhetsspeil">
          <Big>{fmtNum(r.remaining_against_local_enhetsregisteret)}</Big>
          <Muted className="mt-1">Lokalt estimat, ikke upstream-sannhet.</Muted>
        </Card>
      </Grid>

      {(r.remaining_explanation || r.remaining_estimate_kind) && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {r.remaining_estimate_kind && (
            <div className="font-mono">kind: {r.remaining_estimate_kind}</div>
          )}
          {r.remaining_explanation && (
            <div className="mt-1">{r.remaining_explanation}</div>
          )}
        </div>
      )}

      <Grid>
        <Card label="Due now (estimat)">
          <Big>{fmtNum(s.due_now_estimate)}</Big>
        </Card>
        <Card label="Failed / retry">
          <Big alert={(s.failed_or_retry ?? 0) > 0}>
            {fmtNum(s.failed_or_retry)}
          </Big>
        </Card>
        <Card label="In progress">
          <Big>{fmtNum(s.in_progress)}</Big>
        </Card>
        <Card label="In progress (stuck)">
          <Big alert={(s.in_progress_stuck ?? 0) > 0}>
            {fmtNum(s.in_progress_stuck)}
          </Big>
        </Card>
      </Grid>

      {Object.keys(byStatus).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([status, n]) => (
            <span
              key={status}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs"
            >
              <span className="font-mono">{status}</span>
              <span className="text-muted-foreground">{fmtNum(n)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-foreground">
          Siste regnskaps-run
        </h3>
        {lr ? (
          <div className="mt-2 rounded-lg border border-border bg-card p-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KV label="status" value={lr.status ?? "—"} />
              <KV label="mode" value={lr.mode ?? "—"} />
              <KV label="selected" value={fmtNum(lr.selected_count)} />
              <KV label="checked" value={fmtNum(lr.checked_count)} />
              <KV label="with regnskap" value={fmtNum(lr.with_regnskap_count)} />
              <KV label="no regnskap" value={fmtNum(lr.no_regnskap_count)} />
              <KV
                label="failed"
                value={fmtNum(lr.failed_count)}
                alert={(lr.failed_count ?? 0) > 0}
              />
              <KV label="skipped" value={fmtNum(lr.skipped_count)} />
              <KV label="records lagret" value={fmtNum(lr.records_lagret)} />
              <KV label="duration" value={fmtMs(lr.duration_ms)} />
              <KV label="startet" value={fmt(lr.started_at)} />
              <KV label="ferdig" value={fmt(lr.finished_at)} />
            </div>
            {lr.last_error && (
              <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive break-all">
                {lr.last_error}
              </div>
            )}
          </div>
        ) : (
          <Muted className="mt-2">Ingen registrert run.</Muted>
        )}
      </div>

      <Grid>
        <Card label="Siste regnskapsår">
          <Big>{r.latest_regnskapsaar ?? "—"}</Big>
        </Card>
        <Card label="Siste hentet">
          <div className="text-sm font-mono">{fmt(r.latest_fetched_at)}</div>
        </Card>
      </Grid>
    </section>
  );
}

function NavSection({ data }: { data: AdminIngestionStatus }) {
  const n = data.nav ?? {};
  const daily = (n.daily_new_unique_postings ?? []).slice().sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );
  const lr = n.latest_run ?? null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-foreground">NAV jobbannonser</h2>
      <Grid>
        <Card label="ACTIVE annonser">
          <Big>{fmtNum(n.active_unique_postings)}</Big>
        </Card>
        <Card label="Nye unike i valgt vindu">
          <Big>{fmtNum(n.new_unique_postings_window)}</Big>
        </Card>
        <Card label="Siste source_posting created">
          <div className="text-sm font-mono">
            {fmt(n.latest_source_posting_created_at)}
          </div>
        </Card>
        <Card label="Siste source_posting seen">
          <div className="text-sm font-mono">
            {fmt(n.latest_source_posting_seen_at)}
          </div>
        </Card>
      </Grid>

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-foreground">Per døgn</h3>
        {daily.length === 0 ? (
          <Muted className="mt-2">Ingen data i vinduet.</Muted>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Dato</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Nye unike annonser
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Innsatte rader
                  </th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono">{d.date}</td>
                    <td className="px-3 py-1.5 text-right">
                      {fmtNum(d.new_unique_postings)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {fmtNum(d.inserted_rows)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {n.daily_definition && (
          <Muted className="mt-2">{n.daily_definition}</Muted>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-foreground">Siste NAV-run</h3>
        {lr ? (
          <div className="mt-2 rounded-lg border border-border bg-card p-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KV label="mode" value={lr.mode ?? "—"} />
              <KV label="fetched" value={fmtNum(lr.fetched)} />
              <KV label="upserted" value={fmtNum(lr.upserted)} />
              <KV label="expired" value={fmtNum(lr.expired)} />
              <KV label="reactivated" value={fmtNum(lr.reactivated)} />
              <KV
                label="matched user_opps"
                value={fmtNum(lr.matched_user_opps)}
              />
              <KV label="scored" value={fmtNum(lr.scored)} />
              <KV label="noop" value={fmtNum(lr.noop)} />
              <KV label="stale" value={fmtNum(lr.stale)} />
              <KV label="startet" value={fmt(lr.started_at)} />
              <KV label="ferdig" value={fmt(lr.finished_at)} />
            </div>
            {lr.error_summary && (
              <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive break-all">
                {lr.error_summary}
              </div>
            )}
          </div>
        ) : (
          <Muted className="mt-2">Ingen registrert run.</Muted>
        )}
      </div>
    </section>
  );
}

function KV({
  label,
  value,
  alert,
}: {
  label: string;
  value: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`font-mono ${alert ? "text-destructive font-semibold" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
