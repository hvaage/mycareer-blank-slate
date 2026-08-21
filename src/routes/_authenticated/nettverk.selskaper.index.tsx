// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </NetworkPanel>
    </div>
  );
}
