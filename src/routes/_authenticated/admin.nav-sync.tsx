import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { getNavSyncStatus, type NavSyncRunRow } from "@/lib/nav-sync.functions";

export const Route = createFileRoute("/_authenticated/admin/nav-sync")({
  head: () => ({
    meta: [
      { title: "Admin · NAV-sync — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminNavSync,
});

const SLOW_RUN_MS = 120_000;
const UNFINISHED_STALE_MS = 60 * 60 * 1000;

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("no-NO");
  } catch {
    return dt;
  }
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function runStatus(r: NavSyncRunRow): {
  label: string;
  cls: string;
  warn?: string;
} {
  if (!r.finished_at) {
    const startedMs = r.started_at ? Date.now() - new Date(r.started_at).getTime() : 0;
    if (startedMs > UNFINISHED_STALE_MS) {
      return { label: "STUCK", cls: "bg-destructive/15 text-destructive" };
    }
    return { label: "IN PROGRESS", cls: "bg-amber-500/15 text-amber-700" };
  }
  if (r.error_summary) {
    return { label: "FAILED", cls: "bg-destructive/15 text-destructive" };
  }
  if (r.duration_ms != null && r.duration_ms > SLOW_RUN_MS) {
    return { label: "SLOW OK", cls: "bg-amber-500/15 text-amber-700" };
  }
  return { label: "OK", cls: "bg-emerald-500/15 text-emerald-700" };
}

function AdminNavSync() {
  const fetchStatus = useServerFn(getNavSyncStatus);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-nav-sync-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const errMessage = error ? (error as Error).message : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">NAV-sync</h1>
            <p className="text-sm text-muted-foreground">
              Read-only oversikt over <code>nav_sync_runs</code>, datakvalitet og
              duplikater. Ingen handlinger fra denne siden.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {isFetching ? "Oppdaterer…" : "Oppdater"}
          </button>
        </div>

        {isLoading && <p className="mt-8 text-muted-foreground">Laster…</p>}

        {errMessage && errMessage.includes("Forbidden") && (
          <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="text-lg font-semibold text-destructive">403 · Ingen tilgang</h2>
            <p className="mt-2 text-sm text-foreground">
              Denne siden er kun for admin-brukere. Din konto mangler admin-rollen
              i <code>user_roles</code>.
            </p>
          </div>
        )}

        {errMessage && !errMessage.includes("Forbidden") && (
          <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {errMessage}
          </div>
        )}

        {data && (
          <>
            {/* Operational summary */}
            <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Cron">
                {data.cron ? (
                  <>
                    <div className="font-mono text-sm">{data.cron.schedule ?? "?"}</div>
                    <div className="mt-1 text-xs">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          data.cron.active
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {data.cron.active ? "ACTIVE" : "INACTIVE"}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {data.cron.jobname}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-destructive text-sm">Ikke registrert</span>
                )}
              </Card>
              <Card label="Vault secret">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    data.vault.has_sync_nav_secret
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  sync_nav_secret{" "}
                  {data.vault.has_sync_nav_secret ? "FUNNET" : "MANGLER"}
                </span>
              </Card>
              <Card label="NAV source_postings">
                <div className="text-2xl font-semibold">
                  {data.duplicates.source_postings_nav}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.duplicates.distinct_external_ids} distinkte external_id
                </div>
              </Card>
              <Card label="Duplikater (external_id)">
                <div
                  className={`text-2xl font-semibold ${
                    data.duplicates.duplicate_external_ids.length
                      ? "text-destructive"
                      : "text-emerald-700"
                  }`}
                >
                  {data.duplicates.duplicate_external_ids.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  unike id-er med &gt;1 rad
                </div>
              </Card>
            </section>

            {/* Quality */}
            <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Mangler nav_detail">
                <div
                  className={`text-2xl font-semibold ${
                    data.quality.nav_source_postings_missing_nav_detail
                      ? "text-destructive"
                      : "text-emerald-700"
                  }`}
                >
                  {data.quality.nav_source_postings_missing_nav_detail}
                </div>
                <div className="text-xs text-muted-foreground">
                  av {data.quality.nav_source_postings} NAV source_postings
                </div>
              </Card>
              <Card label="Canonical (NAV)">
                <div className="text-2xl font-semibold">
                  {data.quality.nav_canonical_total}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.quality.nav_canonical_with_grace} med live_until satt
                  {", "}
                  {data.quality.nav_canonical_expired_visible} i karens
                </div>
              </Card>
              <Card label="user_opportunities (NAV)">
                <div className="text-2xl font-semibold">
                  {data.quality.user_opportunities_nav}
                </div>
                <div className="text-xs text-muted-foreground">
                  card_source = 'nav'
                </div>
              </Card>
              <Card label="INACTIVE source_postings">
                <div className="text-2xl font-semibold">
                  {data.quality.inactive_source_postings}
                </div>
                <div className="text-xs text-muted-foreground">
                  posting_status in (expired, removed)
                </div>
              </Card>
            </section>

            {/* Cursor progress */}
            <section className="mt-6 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Cursor</h2>
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">cursor_changed_at</dt>
                  <dd className="font-mono">
                    {data.cursor_progress.latest_run_cursor_changed_at ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">cursor_external_id</dt>
                  <dd className="font-mono truncate">
                    {data.cursor_progress.latest_run_cursor_external_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    max source_postings.last_seen_at
                  </dt>
                  <dd className="font-mono">
                    {fmt(data.cursor_progress.max_source_posting_last_seen_at)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Duplicate detail */}
            {data.duplicates.duplicate_external_ids.length > 0 && (
              <section className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                <h2 className="text-sm font-semibold text-destructive">
                  Duplikate external_id i source_postings
                </h2>
                <ul className="mt-2 text-xs font-mono space-y-1 max-h-40 overflow-auto">
                  {data.duplicates.duplicate_external_ids.map((d) => (
                    <li key={d.external_id}>
                      <span className="text-muted-foreground">{d.count}×</span>{" "}
                      {d.external_id}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Runs */}
            <section className="mt-8">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  Siste {data.runs.length} sync-runs
                </h2>
                <p className="text-xs text-muted-foreground">
                  Oppdatert {fmt(data.now)}
                </p>
              </div>
              <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40 uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <Th>Status</Th>
                      <Th>Started</Th>
                      <Th>Finished</Th>
                      <Th>Duration</Th>
                      <Th>Fetched</Th>
                      <Th>Upserted</Th>
                      <Th>Expired</Th>
                      <Th>Reactivated</Th>
                      <Th>Issues</Th>
                      <Th>Cursor changed_at</Th>
                      <Th>Error</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.runs.map((r) => {
                      const st = runStatus(r);
                      return (
                        <tr key={r.id} className="text-foreground">
                          <Td>
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 font-medium uppercase tracking-wide ${st.cls}`}
                            >
                              {st.label}
                            </span>
                          </Td>
                          <Td className="whitespace-nowrap">{fmt(r.started_at)}</Td>
                          <Td className="whitespace-nowrap">{fmt(r.finished_at)}</Td>
                          <Td
                            className={
                              r.duration_ms != null && r.duration_ms > SLOW_RUN_MS
                                ? "text-amber-700 font-semibold"
                                : ""
                            }
                          >
                            {fmtMs(r.duration_ms)}
                          </Td>
                          <Td>{r.fetched ?? "—"}</Td>
                          <Td>{r.upserted ?? "—"}</Td>
                          <Td>{r.expired ?? "—"}</Td>
                          <Td>{r.reactivated ?? "—"}</Td>
                          <Td>
                            <span className="text-muted-foreground">data</span>{" "}
                            <span
                              className={
                                r.data_issues_count
                                  ? "text-amber-700 font-medium"
                                  : ""
                              }
                            >
                              {r.data_issues_count}
                            </span>
                            {" · "}
                            <span className="text-muted-foreground">sys</span>{" "}
                            <span
                              className={
                                r.system_errors_count
                                  ? "text-destructive font-semibold"
                                  : ""
                              }
                            >
                              {r.system_errors_count}
                            </span>
                            {" · "}
                            <span className="text-muted-foreground">ai</span>{" "}
                            <span
                              className={
                                r.ai_errors_count
                                  ? "text-amber-700 font-medium"
                                  : ""
                              }
                            >
                              {r.ai_errors_count}
                            </span>
                          </Td>
                          <Td className="font-mono whitespace-nowrap">
                            {r.cursor_changed_at ?? "—"}
                          </Td>
                          <Td className="text-destructive max-w-xs truncate">
                            {r.error_summary ?? ""}
                          </Td>
                        </tr>
                      );
                    })}
                    {!data.runs.length && (
                      <tr>
                        <td
                          colSpan={11}
                          className="p-8 text-center text-muted-foreground"
                        >
                          Ingen runs registrert.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
