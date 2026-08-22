// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Briefcase, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useAuthUserId } from "@/components/network/use-network-user";
import { buildOpportunities, networkGraphQuery } from "@/lib/queries/network";

const searchSchema = z.object({
  tilstand: z.enum(["apen", "alle"]).default("apen"),
});

export const Route = createFileRoute("/_authenticated/nettverk/muligheter/")({
  validateSearch: (search) => searchSchema.parse(search),
  component: OpportunitiesPage,
});

function OpportunitiesPage() {
  const userId = useAuthUserId();
  const { tilstand } = Route.useSearch();
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));

  const all = useMemo(() => (graph ? buildOpportunities(graph) : []), [graph]);
  const list = useMemo(
    () => (tilstand === "apen" ? all.filter((o) => o.isOpen) : all),
    [all, tilstand],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/nettverk/muligheter"
          search={{ tilstand: "apen" }}
          className={
            tilstand === "apen"
              ? "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
              : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
          }
        >
          Aktive
        </Link>
        <Link
          to="/nettverk/muligheter"
          search={{ tilstand: "alle" }}
          className={
            tilstand === "alle"
              ? "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
              : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
          }
        >
          Alle
        </Link>
      </div>

      <NetworkPanel title={`Muligheter (${list.length.toLocaleString("nb-NO")})`}>
        {isLoading ? (
          <PanelEmpty>Laster muligheter…</PanelEmpty>
        ) : list.length === 0 ? (
          <PanelEmpty>
            Ingen muligheter er lagret ennå. Muligheter du følger opp vises her.
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((o) => (
              <li key={o.id} className="flex items-start gap-2 py-2">
                <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/nettverk/muligheter/$id"
                    params={{ id: o.id }}
                    className="truncate font-medium underline-offset-2 hover:underline"
                  >
                    {o.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[o.company, o.location].filter(Boolean).join(" · ") || "Uten selskap"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.nextActivity
                      ? `Neste aktivitet: ${o.nextActivity.due_date ?? "uten dato"} — ${o.nextActivity.title}`
                      : "Ingen planlagt aktivitet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {o.status ? <Badge variant="outline">{o.status}</Badge> : null}
                  {o.url ? (
                    <a href={o.url} target="_blank" rel="noreferrer" aria-label="Åpne annonse">
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </NetworkPanel>
    </div>
  );
}
