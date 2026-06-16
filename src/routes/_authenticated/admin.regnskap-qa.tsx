/**
 * MIDLERTIDIG admin-only QA-side for M5.2 regnskap-sync.
 * Ingen UI-lenke andre steder. Slett denne filen + lib/regnskap-sync-qa.functions.ts
 * når M5.2 er lukket.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { runRegnskapSyncQa } from "@/lib/regnskap-sync-qa.functions";
import { checkRegnskapSyncEnv } from "@/lib/regnskap-sync-env.functions";

export const Route = createFileRoute("/_authenticated/admin/regnskap-qa")({
  head: () => ({
    meta: [
      { title: "Admin · Regnskap sync QA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegnskapQaPage,
});

function RegnskapQaPage() {
  const run = useServerFn(runRegnskapSyncQa);
  const checkEnv = useServerFn(checkRegnskapSyncEnv);
  const [result, setResult] = useState<any>(null);
  const [env, setEnv] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      setResult(null);
      return await run();
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => setErr(e?.message ?? String(e)),
  });

  const envMut = useMutation({
    mutationFn: async () => {
      setErr(null);
      setEnv(null);
      return await checkEnv();
    },
    onSuccess: (data) => setEnv(data),
    onError: (e: any) => setErr(e?.message ?? String(e)),
  });

  const v = result?.verification;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">M5.2 Regnskap sync — QA</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Kjør dryRun → real → re-run real for 5 faste orgnr. Admin-only,
        server-side. Slettes etter M5.2 er lukket.
      </p>

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => envMut.mutate()}
          disabled={envMut.isPending}
          className="inline-flex h-10 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {envMut.isPending ? "Sjekker env…" : "Sjekk env (presence)"}
        </button>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {mut.isPending ? "Kjører… (kan ta opptil 2 min)" : "Kjør QA-sekvens"}
        </button>
      </div>

      {env && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Env presence (server runtime)
          </h2>
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            {JSON.stringify(env.presence, null, 2)}
          </pre>
        </section>
      )}

      {err && (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {err}
        </div>
      )}

      {v && (
        <section className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="regnskap-rader" value={v.regnskap_rows} />
          <Stat
            label="raw_data NULL alle"
            value={v.raw_data_all_null ? "OK" : "FEIL"}
            ok={v.raw_data_all_null}
          />
          <Stat
            label="attempts ≥ 2 alle"
            value={v.attempts_at_least_2 ? "OK" : "FEIL"}
            ok={v.attempts_at_least_2}
          />
          <Stat label="hentet uendret" value={v.hentet_tidspunkt_unchanged} />
          <Stat
            label="hentet endret"
            value={v.hentet_tidspunkt_changed}
            ok={v.hentet_tidspunkt_changed === 0}
          />
        </section>
      )}

      {result && (
        <>
          <Section title="Run-oppsummering">
            <Pre data={{ dryRun: result.dryRun, real1: result.real1, real2: result.real2 }} />
          </Section>
          <Section title="reg.regnskap_sync_status">
            <Pre data={result.status} />
          </Section>
          <Section title="reg.regnskap_sync_runs">
            <Pre data={result.runs} />
          </Section>
          <Section title="reg.regnskap_sync_run_items">
            <Pre data={result.items} />
          </Section>
          {v?.hentet_tidspunkt_changed > 0 && (
            <Section title="Endrede hentet_tidspunkt (sample)">
              <Pre data={v.hentet_tidspunkt_changed_sample} />
            </Section>
          )}
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        ok === false
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-card"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Pre({ data }: { data: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
