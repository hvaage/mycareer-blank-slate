// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useAuthUserId } from "@/components/network/use-network-user";
import { buildContacts, networkBatchQuery, networkGraphQuery } from "@/lib/queries/network";
import { promoteNetworkBatchContacts } from "@/lib/network.functions";

export const Route = createFileRoute("/_authenticated/nettverk/kontakter/")({
  component: ContactsPage,
});

const OBJECT_KIND_LABEL: Record<string, string> = {
  person_contact: "Personkontakter",
  company_observation: "Selskapsobservasjoner",
  network_event: "Nettverksarrangementer",
  network_preference_signal: "Preferansesignaler",
  invitation: "Invitasjoner uten avklart identitet",
  ukjent: "Uklassifisert",
};

function ContactsPage() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));
  const { data: batchData } = useQuery(networkBatchQuery(userId));
  const promote = useServerFn(promoteNetworkBatchContacts);

  const contacts = useMemo(() => (graph ? buildContacts(graph) : []), [graph]);
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.display_name.toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q) ||
        (c.headline ?? "").toLowerCase().includes(q),
    );
  }, [contacts, term]);

  const promoteMutation = useMutation({
    mutationFn: async () => {
      const ids = batchData?.pendingPersonItemIds ?? [];
      if (!batchData?.batch?.id || ids.length === 0) throw new Error("Ingen personkontakter å legge til.");
      return promote({ data: { batchId: batchData.batch.id, itemIds: ids } });
    },
    onSuccess: (result: any) => {
      if (!result?.ok) {
        toast.error(`Kunne ikke legge til kontakter (${result?.errorCode ?? "ukjent feil"}).`);
        return;
      }
      toast.success(`${result.createdCount} kontakter lagt til i registeret.`);
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunne ikke legge til kontakter."),
  });

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3 md:overflow-hidden">
      <NetworkPanel
        title={`Kontakter (${filtered.length})`}
        className="md:col-span-2"
        actions={
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Filtrer"
            className="h-8 w-36 md:w-52"
            aria-label="Filtrer kontakter"
          />
        }
      >
        {isLoading ? (
          <PanelEmpty>Laster kontakter…</PanelEmpty>
        ) : filtered.length === 0 ? (
          <PanelEmpty>
            Ingen kontakter ennå. Kontakter oppstår når du selv velger å legge til personer fra en
            gjennomgått kildeimport, eller registrerer dem manuelt. Ingenting legges til automatisk.
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  to="/nettverk/kontakter/$id"
                  params={{ id: c.id }}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 hover:bg-accent/50"
                >
                  <span className="font-medium">{c.display_name}</span>
                  {c.headline ? (
                    <span className="text-muted-foreground">{c.headline}</span>
                  ) : null}
                  {c.company ? <Badge variant="secondary">{c.company}</Badge> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {c.nextActivity
                      ? `Neste: ${c.nextActivity.title}`
                      : c.lastContactAt
                        ? `Sist kontakt: ${new Date(c.lastContactAt).toLocaleDateString("nb-NO")}`
                        : "Ingen aktivitet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </NetworkPanel>

      <NetworkPanel title="Kildeimport: nettverksbatch">
        {!batchData ? (
          <PanelEmpty>Ingen klar nettverksbatch til gjennomgang.</PanelEmpty>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Batch fra LinkedIn-import, status «klar». Ingenting er lagt til i registeret ditt før
              du bekrefter.
            </p>
            <ul className="space-y-1">
              {Object.entries(batchData.objectKindCounts).map(([kind, count]) => (
                <li key={kind} className="flex items-baseline justify-between gap-2">
                  <span>{OBJECT_KIND_LABEL[kind] ?? kind}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
              Kun personkontakter kan legges til som kontakter. Selskapsobservasjoner,
              arrangementer, preferansesignaler og invitasjoner beholdes som signaler.
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="w-full gap-2"
                  disabled={
                    promoteMutation.isPending ||
                    (batchData.pendingPersonItemIds?.length ?? 0) === 0
                  }
                >
                  {promoteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                  Legg til {batchData.pendingPersonItemIds?.length ?? 0} personkontakter
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Legg til personkontakter?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {batchData.pendingPersonItemIds?.length ?? 0} personkontakter fra denne
                    nettverksbatchen legges til i kontaktregisteret ditt. Ingen andre
                    nettverkssignaler berøres, og ingenting skjer før du bekrefter.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={() => promoteMutation.mutate()}>
                    Bekreft og legg til
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </NetworkPanel>
    </div>
  );
}
