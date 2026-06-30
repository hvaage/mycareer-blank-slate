import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import {
  getNavSyncStatus,
  type NavSyncRunRow,
} from "@/lib/nav-sync.functions";
import {
  getCareerjetSyncStatus,
  triggerCareerjetSync,
  type CareerjetRunRow,
  type TriggerCareerjetSyncResult,
} from "@/lib/careerjet-sync.functions";
import { IngestionPanel } from "@/components/admin/IngestionPanel";

type TabKey = "nav" | "careerjet" | "ingestion";

const TAB_LABELS: Record<TabKey, string> = {
  nav: "NAV",
  careerjet: "Careerjet",
  ingestion: "Datainntak",
};

export const Route = createFileRoute("/_authenticated/admin/sync")({
  validateSearch: (s: Record<string, unknown>) => {
    const t = s.tab;
    const tab: TabKey =
      t === "careerjet" || t === "ingestion" || t === "nav" ? t : "nav";
    return { tab };
  },
  head: () => ({
    meta: [
      { title: "Admin · Sync — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSync,
});

const SLOW_RUN_MS = 130_000;
const UNFINISHED_STALE_MS = 60 * 60 * 1000;

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleString("no-NO"); } catch { return dt; }
}
function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function AdminSync() {
  const { tab } = useSearch({ from: "/_authenticated/admin/sync" });
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-foreground">Sync-admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only oversikt over kildesyncer (NAV, Careerjet) og datainntak. Ingen muterende handlinger her.
        </p>

        <div className="mt-6 flex gap-2 border-b border-border">
          {(["nav", "careerjet", "ingestion"] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => navigate({ to: "/admin/sync", search: { tab: t } })}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === "nav" && <NavTab />}
        {tab === "careerjet" && <CareerjetTab />}
        {tab === "ingestion" && <IngestionPanel />}
      </main>
      <Footer />
    </div>
  );
}

function NavTab() {
  const fetchStatus = useServerFn(getNavSyncStatus);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-nav-sync-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
  });
  const errMessage = error ? (error as Error).message : null;

  const inv = data?.target_inventory ?? null;
  const up = data?.upstream_health;
  const upInv = up?.inventory ?? null;
  const ss = up?.steady_state ?? null;
  const rc = up?.reconcile ?? null;
  const dr = up?.detail_retry ?? { pending: 0, abandoned: 0 };
  const repair = data?.repair;
  const ad = data?.active_diff;
  const lease = data?.lease ?? null;
  const repairCron = data?.repair_cron ?? null;

  return (
    <div className="mt-6">
      <div className="flex justify-end gap-2">
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? "Oppdaterer…" : "Oppdater"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Read-only. Repair drives automatisk via pg_cron <code>nav-target-repair-3min</code> (2×100 ID-er per kjøring,
        avplanlegges automatisk når aktiv repair-run er fullført). Cursor-sync drives av <code>nav-sync-30min</code>.
      </p>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card label="Global target writer-lease">
          {lease ? (
            <ul className="text-xs space-y-1">
              <li>navn: <b>{lease.lease_name}</b> · mode: <b>{lease.mode}</b></li>
              <li className="font-mono break-all">run: {lease.run_id}</li>
              <li>acquired: {fmt(lease.acquired_at)} · heartbeat: {fmt(lease.heartbeat_at)}</li>
              <li>utløp: {fmt(lease.expires_at)} {lease.is_stale ? <span className="text-destructive">(stale)</span> : null}</li>
            </ul>
          ) : <Muted>ingen aktiv lease</Muted>}
        </Card>
        <Card label="Repair-cron (midlertidig)">
          {repairCron ? (
            <ul className="text-xs space-y-1">
              <li>job: <b>{repairCron.jobname}</b></li>
              <li>schedule: <code>{repairCron.schedule ?? "—"}</code></li>
              <li>active: <b>{repairCron.active ? "ja" : "nei"}</b></li>
            </ul>
          ) : <Muted>ikke planlagt (avplanlegges når repair er ferdig)</Muted>}
        </Card>
      </div>
      {isLoading && <p className="mt-6 text-muted-foreground">Laster…</p>}
      {errMessage && <ErrorBox msg={errMessage} />}
      {data && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-foreground">Upstream (NAV-kilde)</h2>
          <Grid>
            <Card label="Upstream cron">
              {up?.fetched_ok ? (
                data.upstream_cron.jobs.length ? (
                  <ul className="text-xs font-mono space-y-1 mt-1">
                    {data.upstream_cron.jobs.map((j) => (
                      <li key={j.jobname}>
                        <Badge active={j.active}>{j.active ? "ON" : "OFF"}</Badge>{" "}
                        <span>{j.jobname}</span>{" "}
                        <span className="text-muted-foreground">{j.schedule}</span>
                      </li>
                    ))}
                  </ul>
                ) : <Muted>Ingen cron-jobber rapportert</Muted>
              ) : <Muted>health unavailable</Muted>}
            </Card>
            <Card label="Upstream inventory">
              {upInv ? (
                <>
                  <Big>{upInv.total.toLocaleString("no-NO")}</Big>
                  <Muted>{upInv.active.toLocaleString("no-NO")} ACTIVE · {upInv.inactive.toLocaleString("no-NO")} INACTIVE</Muted>
                  <Muted>detail: {upInv.active_with_detail.toLocaleString("no-NO")} / mangler {upInv.active_missing_detail.toLocaleString("no-NO")}</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Source event lag">
              {upInv?.source_event_lag_seconds != null ? (
                <>
                  <Big alert={upInv.source_event_lag_seconds > 3600}>
                    {Math.round(upInv.source_event_lag_seconds / 60)} min
                  </Big>
                  <Muted className="font-mono">latest: {fmt(upInv.latest_source_event_at)}</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Detail-retry">
              {(() => {
                const pending = dr?.pending ?? 0;
                const abandoned = dr?.abandoned ?? 0;
                const reconcileRunning = rc?.status === "running";
                let tone: "green" | "yellow" | "red" = "green";
                let label = "Ferdig";
                if (abandoned > 0) { tone = "red"; label = `${abandoned} abandoned`; }
                else if (pending > 0 && reconcileRunning) { tone = "yellow"; label = "Pågår"; }
                else if (pending > 0) { tone = "yellow"; label = "Tømmer kø"; }
                return (
                  <>
                    <div className="flex items-baseline gap-3">
                      <Big alert={false}>{pending}</Big>
                      <span className="text-xs text-muted-foreground">pending</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <ToneBadge tone={abandoned > 0 ? "red" : "green"}>{abandoned} abandoned</ToneBadge>
                      <ToneBadge tone={tone}>{label}</ToneBadge>
                    </div>
                  </>
                );
              })()}
            </Card>
          </Grid>

          <Grid>
            <Card label="Steady cursor">
              {ss ? (
                <>
                  <div className="text-xs font-mono break-all">{ss.feed_url ?? "—"}</div>
                  <Muted>ETag: {ss.has_etag ? "✓" : "—"} · pages {ss.pages_fetched ?? "—"}</Muted>
                  <Muted className="font-mono">heartbeat: {fmt(ss.heartbeat_at)}</Muted>
                  {ss.error && <div className="mt-1 text-destructive">{ss.error}</div>}
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Reconcile-run">
              {rc ? (
                <>
                  <div className="text-xs font-mono break-all">{rc.run_id ?? "—"}</div>
                  <Muted>status: {rc.status ?? "—"} · pages {rc.pages_fetched ?? "—"} · events {rc.events_processed?.toLocaleString("no-NO") ?? "—"}</Muted>
                  <Muted className="font-mono">{rc.current_feed_url ?? "—"}</Muted>
                  <Muted>tail reached: {rc.tail_reached == null ? "—" : (rc.tail_reached ? "ja" : "nei")} · started {fmt(rc.started_at)}</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Upstream/target ACTIVE">
              {ad ? (
                <>
                  <div className="text-xs">upstream: <b>{ad.upstream_active?.toLocaleString("no-NO") ?? "—"}</b></div>
                  <div className="text-xs">target: <b>{ad.target_active?.toLocaleString("no-NO") ?? "—"}</b></div>
                  <Big alert={ad.diff != null && Math.abs(ad.diff) > 100}>
                    {ad.diff != null ? (ad.diff > 0 ? `+${ad.diff}` : `${ad.diff}`) : "—"}
                  </Big>
                  <Muted>diff (target − upstream)</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Upstream duplikater (external_id)">
              <Big alert={(upInv?.duplicate_external_ids ?? 0) > 0}>{upInv?.duplicate_external_ids ?? 0}</Big>
              <Muted>active_expired: {upInv?.active_expired ?? "—"} · uten expiry: {upInv?.active_without_expiry ?? "—"}</Muted>
            </Card>
          </Grid>

          <h2 className="mt-8 text-sm font-semibold text-foreground">Target (karrierenmin.no)</h2>
          <Grid>
            <Card label="Target cron">
              {data.cron ? (
                <>
                  <div className="font-mono text-sm">{data.cron.schedule ?? "?"}</div>
                  <Badge active={!!data.cron.active}>
                    {data.cron.active ? "ACTIVE" : "INACTIVE"} · {data.cron.jobname}
                  </Badge>
                </>
              ) : <Muted>Ikke registrert</Muted>}
            </Card>
            <Card label="Vault secret">
              <VaultBadge status={data.vault.status} />
              {data.vault.status === "check_error" && data.vault.error && (
                <div className="mt-1 text-[10px] text-muted-foreground break-all">{data.vault.error}</div>
              )}
            </Card>
            <Card label="Target inventory">
              {inv ? (
                <>
                  <Big>{inv.total.toLocaleString("no-NO")}</Big>
                  <Muted>{inv.active.toLocaleString("no-NO")} active · {inv.inactive.toLocaleString("no-NO")} expired</Muted>
                  <Muted>extent: {inv.active_with_extent.toLocaleString("no-NO")} · engagement: {inv.active_with_engagement.toLocaleString("no-NO")}</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Target metadata-dekning">
              {inv ? (
                <>
                  <Big alert={inv.rows_with_event_version < inv.total}>
                    {inv.rows_with_event_version.toLocaleString("no-NO")}
                  </Big>
                  <Muted>av {inv.total.toLocaleString("no-NO")} har source_event_version</Muted>
                  <Muted>{((inv.rows_with_event_version / Math.max(inv.total, 1)) * 100).toFixed(1)}%</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
          </Grid>

          <Grid>
            <Card label="Target ACTIVE detail-dekning">
              {inv ? (
                <>
                  <Big alert={inv.active_missing_detail > 0}>{inv.active_missing_detail}</Big>
                  <Muted>av {inv.active} ACTIVE mangler nav_detail</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Target duplikater (external_id)">
              <Big alert={data.duplicates.duplicate_external_ids.length > 0}>
                {data.duplicates.duplicate_external_ids.length}
              </Big>
              <Muted>unike id-er med &gt;1 rad</Muted>
            </Card>
            <Card label="Cursor (target)">
              <div className="text-xs font-mono break-all">
                {data.cursor_progress.latest_run_cursor_changed_at ?? "—"}
              </div>
              <Muted className="font-mono">id: {data.cursor_progress.latest_run_cursor_external_id ?? "—"}</Muted>
              <Muted>siste OK cursor-run: {fmt(data.cursor_progress.last_successful_cursor_finished_at)}</Muted>
            </Card>
            <Card label="user_opportunities (NAV)">
              <Big>{data.quality.user_opportunities_nav}</Big>
              <Muted>card_source = 'nav'</Muted>
            </Card>
          </Grid>

          <h2 className="mt-8 text-sm font-semibold text-foreground">By-ID-reparasjon</h2>
          <Grid>
            <Card label="Aktiv repair-run">
              {repair?.active ? (
                <>
                  <div className="text-xs font-mono break-all">{repair.active.id}</div>
                  <Muted>start: {fmt(repair.active.started_at)} · status {repair.active.status}</Muted>
                  <Muted className="font-mono">cursor: {repair.active.cursor_after_external_id || "—"}</Muted>
                </>
              ) : <Muted>Ingen aktiv</Muted>}
            </Card>
            <Card label="Repair tellere">
              {repair?.active ? (
                <ul className="text-xs space-y-0.5">
                  <li>req: <b>{repair.active.ids_requested}</b> · found: <b>{repair.active.ids_found}</b> · missing: <b>{repair.active.ids_missing}</b></li>
                  <li>merged: <b>{repair.active.rows_merged}</b> · noop: <b>{repair.active.rows_noop}</b></li>
                  <li>stale: <b>{repair.active.rows_stale}</b> · failed: <b className={repair.active.rows_failed > 0 ? "text-destructive" : ""}>{repair.active.rows_failed}</b></li>
                  <li>batches: <b>{repair.active.batches}</b></li>
                </ul>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Forrige repair">
              {repair?.last_completed ? (
                <>
                  <div className="text-xs font-mono break-all">{repair.last_completed.id}</div>
                  <Muted>{repair.last_completed.status} · {fmt(repair.last_completed.finished_at)}</Muted>
                </>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="Health-RPC">
              <Badge active={up?.fetched_ok ?? false}>
                {up?.fetched_ok ? "Upstream OK" : "FEIL"}
              </Badge>
              {!up?.fetched_ok && up?.error && (
                <div className="mt-1 text-xs text-destructive break-all">{up.error}</div>
              )}
            </Card>
          </Grid>

          {data.duplicates.duplicate_external_ids.length > 0 && (
            <section className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <h3 className="text-sm font-semibold text-destructive">
                Duplikate target external_id
              </h3>
              <ul className="mt-2 text-xs font-mono space-y-1 max-h-40 overflow-auto">
                {data.duplicates.duplicate_external_ids.map((d) => (
                  <li key={d.external_id}>
                    <span className="text-muted-foreground">{d.count}×</span> {d.external_id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className="mt-8 text-sm font-semibold text-foreground">Run history</h2>
          <RunsTable rows={data.runs.map(navRunToRow)} cols={navCols} />
        </>
      )}
    </div>
  );
}

function CareerjetTab() {
  const fetchStatus = useServerFn(getCareerjetSyncStatus);
  const triggerSync = useServerFn(triggerCareerjetSync);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-careerjet-sync-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
  });
  const errMessage = error ? (error as Error).message : null;

  const [lastTrigger, setLastTrigger] = useState<
    | { kind: "ok"; result: TriggerCareerjetSyncResult }
    | { kind: "err"; message: string }
    | null
  >(null);

  const mutation = useMutation({
    mutationFn: () => triggerSync(),
    onSuccess: (result) => {
      if (result && typeof result === "object" && "ok" in result) {
        setLastTrigger({ kind: "ok", result: result as TriggerCareerjetSyncResult });
      } else {
        setLastTrigger({
          kind: "err",
          message: `Uventet svar fra server (ingen result): ${JSON.stringify(result)}`,
        });
      }
      refetch();
    },
    onError: (err: unknown) => {
      setLastTrigger({ kind: "err", message: err instanceof Error ? err.message : String(err) });
    },
  });

  return (
    <div className="mt-6">
      <div className="flex justify-end gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? "Kjører sync…" : "Kjør sync nå"}
        </button>
        <button
          onClick={() => {
            setLastTrigger(null);
            refetch();
          }}
          disabled={isFetching}
          className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? "Oppdaterer…" : "Oppdater"}
        </button>
      </div>
      {lastTrigger && (
        <div
          className={`mt-3 rounded-md border p-3 text-xs font-mono whitespace-pre-wrap break-all ${
            lastTrigger.kind === "ok" && lastTrigger.result.ok
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-800"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          }`}
        >
          {lastTrigger.kind === "ok"
            ? `HTTP ${lastTrigger.result.http_status} · ${lastTrigger.result.duration_ms} ms\n${lastTrigger.result.body}`
            : `Feil: ${lastTrigger.message}`}
        </div>
      )}
      {isLoading && <p className="mt-6 text-muted-foreground">Laster…</p>}
      {errMessage && <ErrorBox msg={errMessage} />}
      {data && (
        <>
          <Grid>
            <Card label="Cron">
              {data.cron ? (
                <>
                  <div className="font-mono text-sm">{data.cron.schedule ?? "?"}</div>
                  <Badge active={!!data.cron.active}>
                    {data.cron.active ? "ACTIVE" : "INACTIVE"} · {data.cron.jobname}
                  </Badge>
                </>
              ) : data.cron_check_error ? (
                <>
                  <Badge active={false}>SJEKK FEILET</Badge>
                  <Muted>Status ukjent — RPC-feil: {data.cron_check_error}</Muted>
                </>
              ) : <Muted>Ikke registrert</Muted>}
            </Card>
            <Card label="Vault secret (kun for cron)">
              {data.vault_check_error ? (
                <>
                  <Badge active={false}>SJEKK FEILET</Badge>
                  <Muted>Status ukjent — RPC-feil: {data.vault_check_error}</Muted>
                </>
              ) : (
                <>
                  <Badge active={data.vault.has_sync_careerjet_secret}>
                    sync_careerjet_secret {data.vault.has_sync_careerjet_secret ? "FUNNET" : "MANGLER"}
                  </Badge>
                  <Muted>Manuell trigger bruker runtime-env og er upåvirket.</Muted>
                </>
              )}
            </Card>
            <Card label="Careerjet source_postings">
              <Big>{data.duplicates.source_postings_careerjet}</Big>
              <Muted>{data.duplicates.distinct_external_ids} distinkte external_id</Muted>
            </Card>
            <Card label="Duplikater (external_id)">
              <Big alert={data.duplicates.duplicate_external_ids.length > 0}>
                {data.duplicates.duplicate_external_ids.length}
              </Big>
              <Muted>unike id-er med &gt;1 rad</Muted>
            </Card>
          </Grid>

          <Grid>
            <Card label="Mangler raw_payload">
              <Big alert={data.quality.missing_raw_payload > 0}>
                {data.quality.missing_raw_payload}
              </Big>
              <Muted>av {data.quality.careerjet_source_postings} aktive</Muted>
            </Card>
            <Card label="Canonical (Careerjet)">
              <Big>{data.quality.careerjet_canonical_total}</Big>
              <Muted>{data.quality.careerjet_canonical_with_grace} med live_until satt</Muted>
            </Card>
            <Card label="user_opportunities (Careerjet)">
              <Big>{data.quality.user_opportunities_careerjet}</Big>
              <Muted>card_source = 'careerjet'</Muted>
            </Card>
            <Card label="INACTIVE source_postings">
              <Big>{data.quality.inactive_source_postings}</Big>
              <Muted>posting_status expired/removed</Muted>
            </Card>
          </Grid>

          <Grid>
            <Card label="external_id prefix">
              <ul className="text-xs font-mono space-y-0.5 mt-1">
                {data.prefix_counts.map((p) => (
                  <li key={p.prefix}>
                    <span className="text-muted-foreground">{p.prefix}</span> {p.count}
                  </li>
                ))}
                {data.prefix_counts.length === 0 && <Muted>—</Muted>}
              </ul>
            </Card>
            <Card label="Term-dekning">
              {data.term_coverage ? (
                <ul className="text-xs space-y-0.5 mt-1">
                  <li>aktive: <b>{data.term_coverage.total_active}</b></li>
                  <li>kjørt siste 24h: <b>{data.term_coverage.run_last_24h}</b></li>
                  <li>kjørt siste 7d: <b>{data.term_coverage.run_last_7d}</b></li>
                  <li className="font-mono">
                    eldste last_run_at: {fmt(data.term_coverage.oldest_last_run_at)}
                  </li>
                </ul>
              ) : <Muted>—</Muted>}
            </Card>
            <Card label="last_seen-spredning">
              {data.last_seen ? (
                <ul className="text-xs font-mono space-y-0.5 mt-1">
                  <li>min: {fmt(data.last_seen.min)}</li>
                  <li>med: {fmt(data.last_seen.median)}</li>
                  <li>max: {fmt(data.last_seen.max)}</li>
                </ul>
              ) : <Muted>—</Muted>}
            </Card>
          </Grid>

          {data.duplicates.duplicate_external_ids.length > 0 && (
            <section className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <h2 className="text-sm font-semibold text-destructive">
                Duplikate external_id i source_postings
              </h2>
              <ul className="mt-2 text-xs font-mono space-y-1 max-h-40 overflow-auto">
                {data.duplicates.duplicate_external_ids.map((d) => (
                  <li key={d.external_id}>
                    <span className="text-muted-foreground">{d.count}×</span> {d.external_id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <RunsTable rows={data.runs.map(cjRunToRow)} cols={cjCols} />
        </>
      )}
    </div>
  );
}

// ===== shared UI bits =====
function Grid({ children }: { children: React.ReactNode }) {
  return <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</section>;
}
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-xs text-muted-foreground ${className ?? ""}`}>{children}</div>;
}
function Big({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return <div className={`text-2xl font-semibold ${alert ? "text-destructive" : ""}`}>{children}</div>;
}
function Badge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
      active ? "bg-emerald-500/15 text-emerald-700" : "bg-destructive/15 text-destructive"
    }`}>{children}</span>
  );
}
function ToneBadge({ tone, children }: { tone: "green" | "yellow" | "red" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "green" ? "bg-emerald-500/15 text-emerald-700"
    : tone === "yellow" ? "bg-amber-500/15 text-amber-700"
    : tone === "red" ? "bg-destructive/15 text-destructive"
    : "bg-muted text-muted-foreground";
  return <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{children}</span>;
}
function VaultBadge({ status }: { status: "present" | "missing" | "check_error" }) {
  if (status === "present") return <ToneBadge tone="green">sync_nav_secret TILSTEDE</ToneBadge>;
  if (status === "missing") return <ToneBadge tone="red">sync_nav_secret MANGLER</ToneBadge>;
  return <ToneBadge tone="yellow">Kunne ikke verifisere</ToneBadge>;
}
function ErrorBox({ msg }: { msg: string }) {
  if (msg.includes("Forbidden")) {
    return (
      <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="text-lg font-semibold text-destructive">403 · Ingen tilgang</h2>
        <p className="mt-2 text-sm text-foreground">Krever admin-rolle.</p>
      </div>
    );
  }
  return <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{msg}</div>;
}

type Row = { key: string; cells: Array<{ value: React.ReactNode; className?: string }> };
function RunsTable({ rows, cols }: { rows: Row[]; cols: string[] }) {
  return (
    <section className="mt-8 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-xs">
        <thead className="bg-muted/40 uppercase tracking-wider text-muted-foreground">
          <tr>{cols.map((c) => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key} className="text-foreground">
              {r.cells.map((c, i) => (
                <td key={i} className={`px-3 py-2 align-top ${c.className ?? ""}`}>{c.value}</td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="p-8 text-center text-muted-foreground">
                Ingen runs registrert.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function StatusPill({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 font-medium uppercase tracking-wide ${cls}`}>{label}</span>;
}

const navCols = ["Status","Started","Finished","Duration","Fetched","Upserted","Expired","Reactivated","Issues","Cursor changed_at","Error"];
function navRunToRow(r: NavSyncRunRow): Row {
  let st: { label: string; cls: string };
  if (!r.finished_at) {
    const ms = r.started_at ? Date.now() - new Date(r.started_at).getTime() : 0;
    st = ms > UNFINISHED_STALE_MS
      ? { label: "STUCK", cls: "bg-destructive/15 text-destructive" }
      : { label: "IN PROGRESS", cls: "bg-amber-500/15 text-amber-700" };
  } else if (r.error_summary) {
    st = { label: "FAILED", cls: "bg-destructive/15 text-destructive" };
  } else if (r.duration_ms != null && r.duration_ms > SLOW_RUN_MS) {
    st = { label: "SLOW OK", cls: "bg-amber-500/15 text-amber-700" };
  } else {
    st = { label: "OK", cls: "bg-emerald-500/15 text-emerald-700" };
  }
  return {
    key: r.id,
    cells: [
      { value: <StatusPill {...st} /> },
      { value: fmt(r.started_at), className: "whitespace-nowrap" },
      { value: fmt(r.finished_at), className: "whitespace-nowrap" },
      { value: fmtMs(r.duration_ms), className: r.duration_ms != null && r.duration_ms > SLOW_RUN_MS ? "text-amber-700 font-semibold" : "" },
      { value: r.fetched ?? "—" },
      { value: r.upserted ?? "—" },
      { value: r.expired ?? "—" },
      { value: r.reactivated ?? "—" },
      { value: `data ${r.data_issues_count} · sys ${r.system_errors_count} · ai ${r.ai_errors_count}` },
      { value: r.cursor_changed_at ?? "—", className: "font-mono whitespace-nowrap" },
      { value: r.error_summary ?? "", className: "text-destructive max-w-xs truncate" },
    ],
  };
}

const cjCols = ["Status","Started","Finished","Duration","Terms","Fetched","Upserted","Expired","Reactivated","Failed","API errors","Cursor","Error"];
function cjRunToRow(r: CareerjetRunRow): Row {
  let st: { label: string; cls: string };
  if (!r.finished_at) {
    const ms = r.started_at ? Date.now() - new Date(r.started_at).getTime() : 0;
    st = ms > UNFINISHED_STALE_MS
      ? { label: "STUCK", cls: "bg-destructive/15 text-destructive" }
      : { label: "RUNNING", cls: "bg-amber-500/15 text-amber-700" };
  } else if (r.status === "failed") {
    st = { label: "FAILED", cls: "bg-destructive/15 text-destructive" };
  } else if (r.status === "partial") {
    st = { label: "PARTIAL", cls: "bg-amber-500/15 text-amber-700" };
  } else if (r.duration_ms != null && r.duration_ms > SLOW_RUN_MS) {
    st = { label: "SLOW OK", cls: "bg-amber-500/15 text-amber-700" };
  } else {
    st = { label: "OK", cls: "bg-emerald-500/15 text-emerald-700" };
  }
  return {
    key: r.id,
    cells: [
      { value: <StatusPill {...st} /> },
      { value: fmt(r.started_at), className: "whitespace-nowrap" },
      { value: fmt(r.finished_at), className: "whitespace-nowrap" },
      { value: fmtMs(r.duration_ms), className: r.duration_ms != null && r.duration_ms > SLOW_RUN_MS ? "text-amber-700 font-semibold" : "" },
      { value: r.terms_covered },
      { value: r.rows_fetched },
      { value: r.rows_upserted },
      { value: r.rows_expired },
      { value: r.rows_reactivated },
      { value: r.rows_failed, className: r.rows_failed > 0 ? "text-amber-700 font-semibold" : "" },
      { value: r.api_errors_count, className: r.api_errors_count > 0 ? "text-destructive font-semibold" : "" },
      { value: `${r.cursor_term ?? "—"} p${r.cursor_page ?? "—"}`, className: "font-mono whitespace-nowrap" },
      { value: r.error_summary ?? "", className: "text-destructive max-w-xs truncate" },
    ],
  };
}
