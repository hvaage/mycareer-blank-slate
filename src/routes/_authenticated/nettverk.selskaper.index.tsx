// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { hideCompany } from "@/lib/network.functions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useAuthUserId } from "@/components/network/use-network-user";
import { buildCompanies, networkGraphQuery } from "@/lib/queries/network";

export const Route = createFileRoute("/_authenticated/nettverk/selskaper/")({
  component: CompaniesPage,
});

export const STATUS_LABEL: Record<string, string> = {
  following: "Følger",
  target: "Målselskap",
  active_dialogue: "Aktiv dialog",
  applied: "Søkt",
  former_employer: "Tidligere arbeidsgiver",
  paused: "På pause",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Lav",
  normal: "Normal",
  high: "Høy",
};

function CompaniesPage() {
  const userId = useAuthUserId();
  const [term, setTerm] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ key: string; companyId: string | null; name: string } | null>(null);
  const queryClient = useQueryClient();
  const hideCompanyFn = useServerFn(hideCompany);
  const hideMutation = useMutation({
    mutationFn: (input: { companyKey: string; companyId: string | null; companyName: string }) =>
      hideCompanyFn({ data: input }),
    onSuccess: (res) => {
      if (!res?.ok) {
        toast.error("Kunne ikke fjerne selskapet.");
        return;
      }
      toast.success("Selskapet er fjernet fra registeret ditt.");
      queryClient.invalidateQueries({ queryKey: ["network", "graph", userId] });
    },
    onError: () => toast.error("Kunne ikke fjerne selskapet."),
    onSettled: () => setPendingDelete(null),
  });
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));
  const companies = useMemo(() => (graph ? buildCompanies(graph) : []), [graph]);
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
  }, [companies, term]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:overflow-hidden">
      <NetworkPanel
        title={`Selskaper (${filtered.length})`}
        className="min-h-0 flex-1"
        actions={
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Filtrer"
            className="h-8 w-36 md:w-52"
            aria-label="Filtrer selskaper"
          />
        }
      >
        {isLoading ? (
          <PanelEmpty>Laster selskaper…</PanelEmpty>
        ) : filtered.length === 0 ? (
          <PanelEmpty>
            Ingen selskaper ennå. Selskaper kommer fra kontakter du har lagt til, fra dine
            jobbmuligheter, eller fra et selskapsforhold du oppretter selv.
          </PanelEmpty>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Selskap</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2">Prioritet</th>
                  <th className="py-1 pr-2 text-right">Kontakter</th>
                  <th className="py-1 pr-2 text-right">Åpne muligheter</th>
                  <th className="py-1 pr-2">Neste aktivitet</th>
                  <th className="py-1 pr-2 text-right">Fjern</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.key} className="hover:bg-accent/50">
                    <td className="py-2 pr-2">
                      <Link
                        to="/nettverk/selskaper/$id"
                        params={{ id: c.key }}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.industry || c.location ? (
                        <div className="text-xs text-muted-foreground">
                          {[c.industry, c.location].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {c.status ? (
                        <Badge variant="secondary">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {c.priority ? PRIORITY_LABEL[c.priority] ?? c.priority : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{c.contactCount}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{c.openOpportunityCount}</td>
                    <td className="py-2 pr-2 text-muted-foreground">
                      {c.nextActivity ? c.nextActivity.title : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Fjern ${c.name} fra registeret`}
                        onClick={() =>
                          setPendingDelete({ key: c.key, companyId: c.companyId, name: c.name })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </NetworkPanel>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => (open ? null : setPendingDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne «{pendingDelete?.name}» fra registeret ditt?</AlertDialogTitle>
            <AlertDialogDescription>
              Selskapet skjules i din oversikt over selskaper. Kontakter, muligheter og
              importert kildedata endres ikke, og du kan hente selskapet tilbake senere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={hideMutation.isPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={hideMutation.isPending}
              onClick={() =>
                pendingDelete &&
                hideMutation.mutate({
                  companyKey: pendingDelete.key,
                  companyId: pendingDelete.companyId,
                  companyName: pendingDelete.name,
                })
              }
            >
              Fjern selskapet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
