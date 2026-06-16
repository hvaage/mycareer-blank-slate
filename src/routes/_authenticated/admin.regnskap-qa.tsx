/**
 * MIDLERTIDIG admin-only QA-side for M5.2 regnskap-sync.
 * Kaller Edge Function `regnskap-sync` (op='qa') med caller-JWT (admin-session).
 * Edge Function gjør has_role-sjekk og kjører QA-sekvens mot reg.* internt.
 * Slett denne filen + Edge Function når M5.2 er lukket.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/regnskap-qa")({
  head: () => ({
    meta: [
      { title: "Admin · Regnskap sync QA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegnskapQaPage,
});

type EdgeErr = {
  message: string;
  status: number | null;
  stage: string | null;
  code: string | null;
  reqId: string | null;
  runId: number | null;
  debug?: Record<string, unknown>;
};

async function parseEdgeError(error: any): Promise<EdgeErr> {
  const out: EdgeErr = { message: "", status: null, stage: null, code: null, reqId: null, runId: null, debug: {} };
  const context = error?.context;
  const contextKeys = context && typeof context === "object" ? Object.keys(context) : [];
  const candidates = [
    context instanceof Response ? context : null,
    context?.response instanceof Response ? context.response : null,
    error?.response instanceof Response ? error.response : null,
    error?.cause?.response instanceof Response ? error.cause.response : null,
  ].filter(Boolean) as Response[];
  const resp = candidates[0];
  let raw = "";
  let body: any = null;

  out.debug = {
    errorName: error?.name ?? null,
    errorMessage: error?.message ?? null,
    contextType: typeof context,
    contextIsResponse: context instanceof Response,
    contextResponseIsResponse: context?.response instanceof Response,
    responseIsResponse: error?.response instanceof Response,
    causeResponseIsResponse: error?.cause?.response instanceof Response,
    contextKeys,
    responseFound: resp instanceof Response,
    responseStatus: resp?.status ?? null,
  };

  if (resp instanceof Response) {
    out.status = resp.status;
    try { raw = await resp.clone().text(); } catch (e) { raw = `[body read failed: ${e instanceof Error ? e.message : String(e)}]`; }
    out.debug.responseBodyText = raw.slice(0, 1500);
    if (raw) {
      try {
        body = JSON.parse(raw);
        out.debug.responseBodyJson = body;
        out.message = String(body?.error ?? body?.message ?? resp.statusText ?? "Edge Function error");
        out.stage = body?.stage ?? null;
        out.code = body?.code ?? null;
        out.reqId = body?.reqId ?? null;
        out.runId = typeof body?.runId === "number" ? body.runId : null;
        return out;
      } catch {
        out.message = raw.slice(0, 500) || resp.statusText;
        return out;
      }
    }
    out.message = resp.statusText || `HTTP ${resp.status}`;
    return out;
  }
  out.message = error?.message ?? String(error);
  return out;
}

function RegnskapQaPage() {
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<EdgeErr | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      setResult(null);
      const { data, error } = await supabase.functions.invoke("regnskap-sync", {
        body: { op: "qa" },
      });
      if (error) {
        const parsed = await parseEdgeError(error);
        throw parsed;
      }
      if (data?.error) {
        throw {
          message: String(data.error),
          status: typeof data.httpStatus === "number" ? data.httpStatus : 200,
          stage: data.stage ?? null,
          code: data.code ?? null,
          reqId: data.reqId ?? null,
          runId: typeof data.runId === "number" ? data.runId : null,
        } satisfies EdgeErr;
      }
      return data;
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => setErr(e && typeof e === "object" && "message" in e ? e as EdgeErr : { message: String(e), status: null, stage: null, code: null, reqId: null, runId: null }),
  });

  const v = result?.verification;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">M5.2 Regnskap sync — QA</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Kjører real → re-run for 5 faste orgnr via Edge Function. Admin-only.
        Slettes etter M5.2-lukking.
      </p>

      <div className="mt-6">
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {mut.isPending ? "Kjører… (kan ta opptil 2 min)" : "Kjør QA-sekvens"}
        </button>
      </div>

      {err && (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive space-y-2">
          <div className="font-semibold">QA feilet</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><span className="opacity-70">HTTP:</span> {err.status ?? "—"}</div>
            <div><span className="opacity-70">stage:</span> {err.stage ?? "unknown"}</div>
            <div><span className="opacity-70">code:</span> {err.code ?? "—"}</div>
            <div><span className="opacity-70">runId:</span> {err.runId ?? "—"}</div>
          </div>
          <div className="text-xs whitespace-pre-wrap break-words">{err.message}</div>
          {err.reqId && <div className="text-[10px] opacity-60">reqId: {err.reqId}</div>}
        </div>
      )}

      {v && (
        <section className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="regnskap-rader" value={v.regnskap_rows} />
          <Stat label="raw_data NULL alle" value={v.raw_data_all_null ? "OK" : "FEIL"} ok={v.raw_data_all_null} />
          <Stat label="attempts Δ ≥ 2 alle" value={v.attempts_delta_at_least_2_all ? "OK" : "FEIL"} ok={v.attempts_delta_at_least_2_all} />
          <Stat label="hentet uendret" value={v.hentet_tidspunkt_unchanged} />
          <Stat label="hentet endret" value={v.hentet_tidspunkt_changed} ok={v.hentet_tidspunkt_changed === 0} />
          <Stat label="runs (forventet 2)" value={`${v.runs_inserted} (dryRun: ${v.runs_dry_run_inserted})`} ok={v.runs_inserted === v.runs_expected && v.runs_dry_run_inserted === 0} />
        </section>
      )}

      {result && (
        <>
          <Section title="Real run 1 + re-run">
            <Pre data={{ real1: result.real1, real2: result.real2 }} />
          </Section>
          <Section title="attempts delta (before/after)">
            <Pre data={v?.attempts_delta} />
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

function Stat({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${ok === false ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
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
