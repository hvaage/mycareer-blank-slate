// @ts-nocheck
// ============================================================
// Fase 5H — Selskapsavstemming.
//
// Navnelikhet gir kun forslag. Ingen kobling skjer uten at brukeren
// bekrefter, og massebekreftelse er begrenset til entydige kandidater.
// ============================================================
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { NetworkErrorState } from "@/components/network/network-error";
import { useAuthUserId } from "@/components/network/use-network-user";
import {
  bucketReconciliation,
  companyReconciliationQuery,
  MATCH_METHOD_LABEL,
  SOURCE_LABEL,
  reconciliationMessage,
  type ReconciliationRow,
} from "@/lib/queries/company-reconciliation";
import { searchEmployersQuery } from "@/lib/queries/employer-insight";
import {
  confirmCompanyReconciliation,
  confirmCompanyReconciliationBulk,
  scanCompanyReconciliation,
  setCompanyReconciliationState,
} from "@/lib/network-company-reconciliation.functions";

export const Route = createFileRoute("/_authenticated/nettverk/selskaper/avstemming")({
  component: ReconciliationPage,
});

function ReconciliationPage() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  const { data: rows, isLoading, isError, refetch } = useQuery(companyReconciliationQuery(userId));
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<null | {
    confirmed: number;
    alreadyLinked: number;
    failed: number;
    failures: Array<{ id: string; status: string }>;
  }>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["network", "company-reconciliation", userId] });
    queryClient.invalidateQueries({ queryKey: ["network", "graph", userId] });
  };

  const scanFn = useServerFn(scanCompanyReconciliation);
  const scanMutation = useMutation({
    mutationFn: () => scanFn({ data: { limit: 300 } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error("Kunne ikke hente kandidater.");
        return;
      }
      toast.success(
        res.remaining > 0
          ? `${res.processed} nye forslag. ${res.remaining} gjenstår — kjør igjen.`
          : `${res.processed} nye forslag. Alle kilder er gjennomgått.`,
      );
      invalidate();
    },
    onError: () => toast.error("Kunne ikke hente kandidater."),
  });

  const bulkFn = useServerFn(confirmCompanyReconciliationBulk);
  const bulkMutation = useMutation({
    mutationFn: (items: Array<{ id: string; orgnr: string }>) => bulkFn({ data: { items } }),
    onSuccess: (res) => {
      setLastResult({
        confirmed: res.confirmed,
        alreadyLinked: res.alreadyLinked,
        failed: res.failed,
        failures: res.failures ?? [],
      });
      setSelected({});
      invalidate();
      if (res.failed > 0) toast.warning(`${res.confirmed} koblet, ${res.failed} feilet.`);
      else toast.success(`${res.confirmed} selskaper koblet.`);
    },
    onError: () => toast.error("Kunne ikke bekrefte koblingene."),
    onSettled: () => setConfirmOpen(false),
  });

  const buckets = useMemo(() => bucketReconciliation(rows ?? []), [rows]);
  const q = term.trim().toLowerCase();
  const match = (list: ReconciliationRow[]) =>
    q ? list.filter((r) => r.observed_name.toLowerCase().includes(q)) : list;

  const exact = match(buckets.exact);
  const selectedItems = exact
    .filter((r) => selected[r.id])
    .map((r) => ({ id: r.id, orgnr: r.candidates?.[0]?.orgnr ?? "" }))
    .filter((r) => /^\d{9}$/.test(r.orgnr));

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Selskapsavstemming</h2>
          <p className="text-sm text-muted-foreground">
            LinkedIn-navnet beholdes som kildeobservasjon. En kobling til et registrert selskap
            opprettes bare når du bekrefter den.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/nettverk/selskaper"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Til selskapslisten
          </Link>
          <Button size="sm" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            {scanMutation.isPending ? "Søker…" : "Finn kandidater"}
          </Button>
        </div>
      </div>

      {lastResult ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <p>
            {lastResult.confirmed} koblet · {lastResult.alreadyLinked} allerede koblet ·{" "}
            {lastResult.failed} feilet
          </p>
          {lastResult.failures.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {lastResult.failures.slice(0, 10).map((f) => (
                <li key={f.id}>{reconciliationMessage(f.status)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 md:overflow-y-auto">
        <NetworkPanel
          title={`Entydige kandidater (${exact.length})`}
          actions={
            <>
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Filtrer"
                className="h-8 w-32 md:w-52"
                aria-label="Filtrer selskapsnavn"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelected((prev) => {
                    const allSelected = exact.every((r) => prev[r.id]);
                    const next = { ...prev };
                    for (const r of exact) next[r.id] = !allSelected;
                    return next;
                  })
                }
                disabled={exact.length === 0}
              >
                Velg alle
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={selectedItems.length === 0 || bulkMutation.isPending}
              >
                Bekreft {selectedItems.length > 0 ? `(${selectedItems.length})` : ""}
              </Button>
            </>
          }
        >
          {isLoading ? (
            <PanelEmpty>Laster forslag…</PanelEmpty>
          ) : exact.length === 0 ? (
            <PanelEmpty>
              Ingen entydige kandidater akkurat nå. Trykk «Finn kandidater» for å søke i
              arbeidsgiverregisteret.
            </PanelEmpty>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3 2xl:grid-cols-4">
              {exact.map((row) => {
                const cand = row.candidates?.[0];
                return (
                  <label
                    key={row.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2"
                  >
                    <Checkbox
                      checked={!!selected[row.id]}
                      onCheckedChange={(v) =>
                        setSelected((prev) => ({ ...prev, [row.id]: v === true }))
                      }
                      aria-label={`Velg ${row.observed_name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.observed_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        → {cand?.navn} · {cand?.orgnr}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[cand?.organisasjonsform, cand?.kommune].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        Kilde: {SOURCE_LABEL[row.source_system] ?? row.source_system}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Mulige kandidater (${match(buckets.possible).length})`}>
          {match(buckets.possible).length === 0 ? (
            <PanelEmpty>Ingen tvetydige selskapsnavn til gjennomgang.</PanelEmpty>
          ) : (
            <div className="space-y-2">
              {match(buckets.possible).map((row) => (
                <PossibleRow key={row.id} row={row} onDone={invalidate} />
              ))}
            </div>
          )}
        </NetworkPanel>

        <NetworkPanel
          title={`Ikke funnet i registeret (${match(buckets.notFound).length})`}
          defaultOpen={false}
        >
          <UnmatchedList rows={match(buckets.notFound)} onDone={invalidate} />
        </NetworkPanel>

        <NetworkPanel
          title={`Utenlandsk eller ukjent (${match(buckets.foreign).length})`}
          defaultOpen={false}
        >
          <UnmatchedList rows={match(buckets.foreign)} onDone={invalidate} />
        </NetworkPanel>

        <NetworkPanel title={`Koblet (${match(buckets.confirmed).length})`} defaultOpen={false}>
          {match(buckets.confirmed).length === 0 ? (
            <PanelEmpty>Ingen bekreftede koblinger ennå.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {match(buckets.confirmed).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{row.observed_name}</span>
                  <span className="text-muted-foreground">→ {row.orgnr}</span>
                  <Badge variant="secondary">
                    {MATCH_METHOD_LABEL[row.match_method ?? ""] ?? row.match_method}
                  </Badge>
                  {row.company_id ? (
                    <Link
                      to="/nettverk/selskaper/$id"
                      params={{ id: row.company_id }}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      Åpne selskapet
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel
          title={`Avvist og ikke aktuelt (${match(buckets.dismissed).length})`}
          defaultOpen={false}
        >
          {match(buckets.dismissed).length === 0 ? (
            <PanelEmpty>Ingen avviste forslag.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {match(buckets.dismissed).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{row.observed_name}</span>
                  <ReopenButton row={row} onDone={invalidate} />
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekreft {selectedItems.length} koblinger</AlertDialogTitle>
            <AlertDialogDescription>
              Du kobler {selectedItems.length} observerte selskapsnavn til den foreslåtte juridiske
              enheten i arbeidsgiverregisteret. Koblingen legges ved siden av LinkedIn-navnet, og
              status eller prioritet endres ikke.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkMutation.mutate(selectedItems)}
              disabled={bulkMutation.isPending}
            >
              {bulkMutation.isPending ? "Kobler…" : "Bekreft koblingene"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function useStateMutation(onDone: () => void) {
  const stateFn = useServerFn(setCompanyReconciliationState);
  return useMutation({
    mutationFn: (input: { id: string; state: "rejected" | "not_applicable" | "reopen" }) =>
      stateFn({ data: input }),
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error("Kunne ikke oppdatere forslaget.");
        return;
      }
      onDone();
    },
    onError: () => toast.error("Kunne ikke oppdatere forslaget."),
  });
}

function ReopenButton({ row, onDone }: { row: ReconciliationRow; onDone: () => void }) {
  const m = useStateMutation(onDone);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={() => m.mutate({ id: row.id, state: "reopen" })}
      disabled={m.isPending}
    >
      Gjenåpne
    </Button>
  );
}

function UnmatchedList({ rows, onDone }: { rows: ReconciliationRow[]; onDone: () => void }) {
  if (rows.length === 0) return <PanelEmpty>Ingen rader.</PanelEmpty>;
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => (
        <RegisterSearchRow key={row.id} row={row} onDone={onDone} />
      ))}
    </div>
  );
}

/** Tvetydig navn: kandidatliste først, deretter eksplisitt registersøk. */
function PossibleRow({ row, onDone }: { row: ReconciliationRow; onDone: () => void }) {
  const confirmFn = useServerFn(confirmCompanyReconciliation);
  const stateMutation = useStateMutation(onDone);
  const confirmMutation = useMutation({
    mutationFn: (input: { orgnr: string; fromRegisterSearch: boolean }) =>
      confirmFn({ data: { id: row.id, ...input } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error(reconciliationMessage(res?.status));
        return;
      }
      toast.success("Selskapet er koblet.");
      onDone();
    },
    onError: () => toast.error("Kunne ikke bekrefte koblingen."),
  });
  const [showSearch, setShowSearch] = useState(false);

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.observed_name}</p>
          <p className="text-xs text-muted-foreground">
            Kilde: {SOURCE_LABEL[row.source_system] ?? row.source_system}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setShowSearch((v) => !v)}
          >
            Søk i registeret
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => stateMutation.mutate({ id: row.id, state: "not_applicable" })}
            disabled={stateMutation.isPending}
          >
            Ikke aktuelt
          </Button>
        </div>
      </div>

      <ul className="mt-2 space-y-1">
        {(row.candidates ?? []).map((c) => (
          <li key={c.orgnr} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{c.navn}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {c.orgnr}
                {c.kommune ? ` · ${c.kommune}` : ""}
                {c.organisasjonsform ? ` · ${c.organisasjonsform}` : ""}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => confirmMutation.mutate({ orgnr: c.orgnr, fromRegisterSearch: false })}
              disabled={confirmMutation.isPending}
            >
              Velg
            </Button>
          </li>
        ))}
      </ul>

      {showSearch ? (
        <RegisterSearch
          initialQuery={row.observed_name}
          onPick={(orgnr) => confirmMutation.mutate({ orgnr, fromRegisterSearch: true })}
          pending={confirmMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function RegisterSearchRow({ row, onDone }: { row: ReconciliationRow; onDone: () => void }) {
  const confirmFn = useServerFn(confirmCompanyReconciliation);
  const stateMutation = useStateMutation(onDone);
  const [open, setOpen] = useState(false);
  const confirmMutation = useMutation({
    mutationFn: (orgnr: string) =>
      confirmFn({ data: { id: row.id, orgnr, fromRegisterSearch: true } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error(reconciliationMessage(res?.status));
        return;
      }
      toast.success("Selskapet er koblet.");
      onDone();
    },
    onError: () => toast.error("Kunne ikke bekrefte koblingen."),
  });

  return (
    <div className="rounded-md border border-border p-2">
      <p className="truncate text-sm font-medium">{row.observed_name}</p>
      <p className="text-xs text-muted-foreground">
        Kilde: {SOURCE_LABEL[row.source_system] ?? row.source_system}
      </p>
      <div className="mt-1 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          Søk i registeret
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => stateMutation.mutate({ id: row.id, state: "not_applicable" })}
          disabled={stateMutation.isPending}
        >
          Ikke aktuelt
        </Button>
      </div>
      {open ? (
        <RegisterSearch
          initialQuery={row.observed_name}
          onPick={(orgnr) => confirmMutation.mutate(orgnr)}
          pending={confirmMutation.isPending}
        />
      ) : null}
    </div>
  );
}

/** Eksplisitt registersøksflyt: bekreftelsen merkes som manuelt valg. */
function RegisterSearch({
  initialQuery,
  onPick,
  pending,
}: {
  initialQuery: string;
  onPick: (orgnr: string) => void;
  pending: boolean;
}) {
  const [q, setQ] = useState(initialQuery);
  const [active, setActive] = useState(initialQuery);
  const { data, isFetching } = useQuery({
    ...searchEmployersQuery({ q: active, page: 1, pageSize: 8 } as never),
    enabled: active.trim().length >= 2,
  });

  return (
    <div className="mt-2 rounded-md border border-dashed border-border p-2">
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk navn eller organisasjonsnummer"
          className="h-8"
          aria-label="Søk i arbeidsgiverregisteret"
        />
        <Button size="sm" variant="outline" onClick={() => setActive(q)}>
          Søk
        </Button>
      </div>
      {isFetching ? (
        <p className="mt-2 text-xs text-muted-foreground">Søker…</p>
      ) : (data?.rows ?? []).length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Ingen treff. Juster søket.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {(data?.rows ?? []).map((r: any) => (
            <li
              key={r.organisasjonsnummer}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{r.navn}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {r.organisasjonsnummer}
                  {r.forretningsadresse_kommune ? ` · ${r.forretningsadresse_kommune}` : ""}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => onPick(r.organisasjonsnummer)}
                disabled={pending}
              >
                Velg
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
