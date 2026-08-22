// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Flame, ListChecks, Sparkles, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useNetworkGraph } from "@/components/network/use-network-user";
import { NetworkErrorState } from "@/components/network/network-error";
import {
  activeOpportunities,
  followUpActivities,
  interviewsThisMonth,
  networkGraphQuery,
  warmContacts,
} from "@/lib/queries/network";

export const Route = createFileRoute("/_authenticated/nettverk/oversikt")({
  component: OverviewPage,
});

function OverviewPage() {
  const { userId, graph, isLoading, isError, refetch } = useNetworkGraph();

  const followUp = useMemo(() => (graph ? followUpActivities(graph) : []), [graph]);
  const opportunities = useMemo(() => (graph ? activeOpportunities(graph) : []), [graph]);
  const warm = useMemo(() => (graph ? warmContacts(graph) : []), [graph]);
  const interviews = useMemo(() => (graph ? interviewsThisMonth(graph) : []), [graph]);

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ListChecks}
          label="Trenger oppfølging"
          value={followUp.length}
          to="/nettverk/aktiviteter"
          search={{ tilstand: "apen", forfall: "alle" }}
          loading={isLoading}
        />
        <StatCard
          icon={Briefcase}
          label="Aktive muligheter"
          value={opportunities.length}
          to="/nettverk/muligheter"
          search={{ tilstand: "apen" }}
          loading={isLoading}
        />
        <StatCard
          icon={Flame}
          label="Varme kontakter"
          value={warm.length}
          anchor="#varme-kontakter"
          loading={isLoading}
        />
        <StatCard
          icon={CalendarClock}
          label="Intervjuer denne måneden"
          value={interviews.length}
          anchor="#intervjuer"
          loading={isLoading}
        />
      </div>

      <NetworkPanel
        title="KI-forslag"
        actions={
          <Button size="sm" variant="outline" disabled>
            <Sparkles className="mr-1 h-4 w-4" /> Få aktivitetsforslag — kommer snart
          </Button>
        }
      >
        <PanelEmpty>
          Forslag til neste aktivitet er ikke aktivert ennå. Når det kommer, blir alt KI-generert
          innhold tydelig merket og må godkjennes av deg.
        </PanelEmpty>
      </NetworkPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <div id="varme-kontakter">
          <NetworkPanel title={`Varme kontakter (${warm.length})`}>
            {isLoading ? (
              <PanelEmpty>Laster…</PanelEmpty>
            ) : warm.length === 0 ? (
              <PanelEmpty>
                Ingen varme kontakter. En kontakt blir varm etter et fullført møte, en samtale eller
                en e-post de siste 90 dagene.
              </PanelEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {warm.map((c) => (
                  <li key={c.id} className="py-2">
                    <Link
                      to="/nettverk/kontakter/$id"
                      params={{ id: c.id }}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {c.display_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.company ?? "Ukjent selskap"}</p>
                  </li>
                ))}
              </ul>
            )}
          </NetworkPanel>
        </div>

        <div id="intervjuer">
          <NetworkPanel title={`Intervjuer denne måneden (${interviews.length})`}>
            {isLoading ? (
              <PanelEmpty>Laster…</PanelEmpty>
            ) : interviews.length === 0 ? (
              <PanelEmpty>Ingen intervjuer registrert denne måneden.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {interviews.map((iv) => (
                  <li key={iv.key} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-medium">{iv.title}</span>
                      <p className="text-xs text-muted-foreground">{iv.date}</p>
                    </div>
                    <Badge variant="outline">
                      {iv.source === "interviews" ? "Intervjuplan" : "Aktivitet"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </NetworkPanel>
        </div>
      </div>

      <NetworkPanel title={`Trenger oppfølging (${followUp.length})`}>
        {isLoading ? (
          <PanelEmpty>Laster…</PanelEmpty>
        ) : followUp.length === 0 ? (
          <PanelEmpty>Ingen åpne aktiviteter.</PanelEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {followUp.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <span className="truncate font-medium">{a.title}</span>
                  <p className="text-xs text-muted-foreground">
                    {a.due_date ?? "Uten dato"}
                    {a.contactName ? ` · ${a.contactName}` : ""}
                  </p>
                </div>
                {a.isOverdue ? <Badge variant="destructive">Forfalt</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </NetworkPanel>

      <SuggestionPanel scope="overview" />
    </div>

  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  to,
  search,
  anchor,
  loading,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  to?: string;
  search?: Record<string, string>;
  anchor?: string;
  loading: boolean;
}) {
  const body = (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{loading ? "—" : value.toLocaleString("nb-NO")}</p>
      </div>
    </div>
  );
  if (to) {
    return (
      <Link to={to} search={search} className="block">
        {body}
      </Link>
    );
  }
  return (
    <a href={anchor} className="block">
      {body}
    </a>
  );
}
