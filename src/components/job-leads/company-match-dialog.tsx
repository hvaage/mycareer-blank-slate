// ============================================================
// Selskapsmatching ved flytting av et jobb-lead.
//
// Navnelikhet gir kun forslag. Ingen kobling opprettes uten at du
// bekrefter den, og «Opprett uten matching» er alltid et tydelig valg.
// ============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchEmployersQuery } from "@/lib/queries/employer-insight";
import {
  confirmCompanyReconciliation,
  setCompanyReconciliationState,
} from "@/lib/network-company-reconciliation.functions";
import type { CompanyMatchResult } from "@/lib/job-leads/promote.functions";

export type PendingCompanyMatch = {
  match: CompanyMatchResult;
  /** Vises i dialogen slik at du vet hvilken annonse det gjelder. */
  contextLabel: string;
};

export function CompanyMatchDialog({
  pending,
  onClose,
}: {
  pending: PendingCompanyMatch | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [dirty, setDirty] = useState(false);

  const observed = pending?.match.observedName ?? "";
  const query = dirty ? term : observed;

  const { data: search, isFetching } = useQuery({
    ...searchEmployersQuery({ q: query.trim(), page: 1, pageSize: 8 }),
    enabled: !!pending && query.trim().length >= 2,
  });

  const candidates = useMemo(() => {
    const fromMatch = (pending?.match.candidates ?? []).map((c) => ({
      orgnr: c.orgnr,
      navn: c.navn,
      sted: c.kommune ?? null,
      form: c.organisasjonsform ?? null,
    }));
    if (dirty) {
      return (search?.rows ?? []).map((r) => ({
        orgnr: r.organisasjonsnummer,
        navn: r.navn,
        sted: r.forretningsadresse_kommune ?? null,
        form: r.naeringskode1_beskrivelse ?? null,
      }));
    }
    if (fromMatch.length > 0) return fromMatch;
    return (search?.rows ?? []).map((r) => ({
      orgnr: r.organisasjonsnummer,
      navn: r.navn,
      sted: r.forretningsadresse_kommune ?? null,
      form: r.naeringskode1_beskrivelse ?? null,
    }));
  }, [pending, search, dirty]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["network"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  };

  const confirmFn = useServerFn(confirmCompanyReconciliation);
  const confirmMutation = useMutation({
    mutationFn: (orgnr: string) =>
      confirmFn({
        data: { id: pending!.match.reconciliationId!, orgnr, fromRegisterSearch: true },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Kunne ikke koble selskapet.");
        return;
      }
      toast.success("Selskapet er koblet mot arbeidsgiverregisteret.");
      invalidate();
      close();
    },
    onError: () => toast.error("Kunne ikke koble selskapet."),
  });

  const skipFn = useServerFn(setCompanyReconciliationState);
  const skipMutation = useMutation({
    mutationFn: () =>
      skipFn({ data: { id: pending!.match.reconciliationId!, state: "not_applicable" } }),
    onSuccess: () => {
      toast.success("Lagret uten selskapskobling.", {
        description: "Du kan koble selskapet senere under Nettverksarbeid → Selskapsavstemming.",
      });
      invalidate();
      close();
    },
    onError: () => toast.error("Kunne ikke lagre valget."),
  });

  const close = () => {
    setTerm("");
    setDirty(false);
    onClose();
  };

  const busy = confirmMutation.isPending || skipMutation.isPending;

  return (
    <Dialog open={!!pending} onOpenChange={(open) => (!open && !busy ? close() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Hvilket selskap er dette?
          </DialogTitle>
          <DialogDescription>
            Vi fant ikke ett entydig selskap for «{observed}» ({pending?.contextLabel}). Juster
            skrivemåten — for eksempel ved å fjerne avdeling, land eller suffiks — og velg riktig
            selskap fra arbeidsgiverregisteret.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              value={query}
              onChange={(e) => {
                setDirty(true);
                setTerm(e.target.value);
              }}
              placeholder="Søk i arbeidsgiverregisteret"
              aria-label="Søk etter selskap"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">
                {isFetching
                  ? "Søker…"
                  : query.trim().length < 2
                    ? "Skriv minst to tegn for å søke."
                    : "Ingen treff. Prøv en kortere skrivemåte, eller opprett uten matching."}
              </p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.orgnr}
                  type="button"
                  disabled={busy}
                  onClick={() => confirmMutation.mutate(c.orgnr)}
                  className="flex w-full flex-col items-start rounded-md border border-border px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                >
                  <span className="text-sm font-medium">{c.navn}</span>
                  <span className="text-xs text-muted-foreground">
                    {[c.orgnr, c.sted, c.form].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Oppretter du uten matching, lagres selskapsnavnet som tekst: ingen
            organisasjonsnummer, ingen registerdata og ingen kobling til Nettverksarbeid →
            Selskaper. Du kan koble det senere.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={busy} onClick={() => skipMutation.mutate()}>
            Opprett uten matching
          </Button>
          <Button variant="outline" disabled={busy} onClick={close}>
            Lukk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
