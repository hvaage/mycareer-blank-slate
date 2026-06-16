import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/admin/regnskap")({
  head: () => ({
    meta: [
      { title: "Admin · Regnskap-sync — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminRegnskap,
});

type RecentRun = {
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

type StatusSummary = {
  byStatus: Record<string, number>;
  total: number;
  missing: number;
  neverSucceeded: number;
  stale: number;
  inProgressStuck: number;
};

type StatusResp = {
  ok: boolean;
  recentRuns?: RecentRun[];
  statusSummary?: StatusSummary;
  now?: string;
  error?: string;
  stage?: string;
  code?: string | null;
  httpStatus?: number;
  reqId?: string;
};

async function invokeRegnskapSync(body: Record<string, unknown>): Promise<any> {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Ikke innlogget", stage: "auth", httpStatus: 401 };
  }
  try {
    const { data, error } = await supabase.functions.invoke("regnskap-sync", {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      const ctx = (error as any).context;
      let parsed: any = null;
      try {
        if (ctx && typeof ctx.text === "function") {
          const txt = await ctx.text();
          try { parsed = JSON.parse(txt); } catch { parsed = { error: txt }; }
        }
      } catch { /* */ }
      return parsed ?? { ok: false, error: error.message, stage: "unknown" };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), stage: "unknown" };
  }
}

function AdminRegnskap() {
  const qc = useQueryClient();
  const [lastAction, setLastAction] = useState<{ kind: string; result: any } | null>(null);

  const statusQuery = useQuery<StatusResp>({
    queryKey: ["regnskap-sync-status"],
    queryFn: () => invokeRegnskapSync({ op: "status" }),
    refetchOnWindowFocus: false,
  });

  const smokeMut = useMutation({
    mutationFn: () => invokeRegnskapSync({ op: "smoke" }),
    onSuccess: (data) => {
      setLastAction({ kind: "smoke", result: data });
      qc.invalidateQueries({ queryKey: ["regnskap-sync-status"] });
    },
  });

  const runMut = useMutation({
    mutationFn: () => invokeRegnskapSync({
      op: "run",
      mode: "due",
      limit: 20,
      rps: 1,
      timeBudgetMs: 50_000,
      includePdfYears: true,
    }),
    onSuccess: (data) => {
      setLastAction({ kind: "run", result: data });
      qc.invalidateQueries({ queryKey: ["regnskap-sync-status"] });
    },
  });

  const status = statusQuery.data;
  const summary = status?.statusSummary;
  const runs = status?.recentRuns ?? [];
  const statusErr = !statusQuery.isLoading && status && status.ok === false ? status : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Regnskap-sync</h1>
          <p className="text-sm text-muted-foreground">
            Admin trigger for regnskap-sync Edge Function. Konservative defaults.
            Ingen MV-refresh i M5.3. Ingen cron schedule aktivert.
          </p>
        </header>

        <section className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {statusQuery.isFetching ? "Henter…" : "Vis status"}
          </button>
          <button
            onClick={() => smokeMut.mutate()}
            disabled={smokeMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            title="op:smoke — mode=due, limit=1, rps=1, timeBudgetMs=20s"
          >
            {smokeMut.isPending ? "Smoke kjører…" : "Kjør smoke (limit=1)"}
          </button>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="inline-flex h-9 items-center rounded-md border border-border bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            title="op:run — mode=due, limit=20, rps=1, timeBudgetMs=50s"
          >
            {runMut.isPending ? "Sync kjører…" : "Kjør sync (konservativ)"}
          </button>
        </section>

        {statusErr && (
          <ErrorBox title="Status feilet" payload={statusErr} />
        )}

        {summary && (
          <section className="mb-8">
            <h2 className="mb-2 text-lg font-semibold">Status-oversikt</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Totalt status-rader" value={summary.total} />
              <Stat label="Mangler status-rad" value={summary.missing} />
              <Stat label="Aldri OK" value={summary.neverSucceeded} />
              <Stat label="Stale (>180d)" value={summary.stale} />
              <Stat label="Stuck in_progress" value={summary.inProgressStuck} />
              {Object.entries(summary.byStatus).map(([k, v]) => (
                <Stat key={k} label={`status=${k}`} value={v} />
              ))}
            </div>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Siste 5 runs</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <Th>ID</Th><Th>Startet</Th><Th>Ferdig</Th><Th>Status</Th>
                  <Th>Mode</Th><Th>Dur ms</Th>
                  <Th>Sel</Th><Th>Chk</Th><Th>OK</Th><Th>NoReg</Th>
                  <Th>Fail</Th><Th>Skip</Th><Th>Recs</Th>
                  <Th>429</Th><Th>503</Th><Th>Retry</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.id}</Td>
                    <Td>{fmtTime(r.started_at)}</Td>
                    <Td>{fmtTime(r.finished_at)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td>{r.mode ?? "—"}{r.dry_run ? " (dry)" : ""}</Td>
                    <Td>{r.duration_ms ?? "—"}</Td>
                    <Td>{r.selected_count ?? 0}</Td>
                    <Td>{r.checked_count ?? 0}</Td>
                    <Td>{r.with_regnskap_count ?? 0}</Td>
                    <Td>{r.no_regnskap_count ?? 0}</Td>
                    <Td>{r.failed_count ?? 0}</Td>
                    <Td>{r.skipped_count ?? 0}</Td>
                    <Td>{r.records_lagret ?? 0}</Td>
                    <Td>{r.http_429_count ?? 0}</Td>
                    <Td>{r.http_503_count ?? 0}</Td>
                    <Td>{r.retry_count ?? 0}</Td>
                    <Td className="max-w-[240px] truncate" title={r.last_error ?? ""}>{r.last_error ?? "—"}</Td>
                  </tr>
                ))}
                {!runs.length && !statusQuery.isLoading && (
                  <tr><td colSpan={17} className="p-6 text-center text-muted-foreground">Ingen runs ennå.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {lastAction && (
          <section className="mb-8">
            <h2 className="mb-2 text-lg font-semibold">Siste handling: {lastAction.kind}</h2>
            <pre className="overflow-auto rounded-md border border-border bg-card p-3 text-xs">
{JSON.stringify(lastAction.result, null, 2)}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "—";
  const cls =
    s === "ok" ? "bg-emerald-500/15 text-emerald-700"
    : s === "partial" ? "bg-amber-500/15 text-amber-700"
    : s === "failed" ? "bg-red-500/15 text-red-700"
    : s === "running" ? "bg-blue-500/15 text-blue-700"
    : "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${cls}`}>{s}</span>;
}

function ErrorBox({ title, payload }: { title: string; payload: any }) {
  return (
    <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <div className="font-semibold text-destructive">{title}</div>
      <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 text-left font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-2 py-1.5 align-top tabular-nums ${className}`} title={title}>{children}</td>;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("no-NO", { hour12: false }); } catch { return s; }
}
