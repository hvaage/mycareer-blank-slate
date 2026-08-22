// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { CalendarClock, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { SuggestionPanel } from "@/components/network/suggestion-panel";
import { useNetworkGraph } from "@/components/network/use-network-user";
import { NetworkErrorState } from "@/components/network/network-error";
import { ActivityDialog, ActivityStatusButton } from "@/components/network/activity-dialog";
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  buildActivities,
  filterActivities,
  networkGraphQuery,
} from "@/lib/queries/network";

/** Validerte URL-filtre: statuskortene og listen viser samme datamengde. */
const searchSchema = z.object({
  tilstand: z.enum(["apen", "utfort", "alle"]).default("apen"),
  forfall: z.enum(["forfalt", "kommende", "alle"]).default("alle"),
  type: z.enum(["oppfolging", "moete", "samtale", "e_post", "soknad", "intervju", "annet"]).optional(),
  prioritet: z.enum(["høy", "middels", "lav"]).optional(),
  kontakt: z.string().uuid().optional(),
  selskap: z.string().optional(),
  mulighet: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/nettverk/aktiviteter/")({
  validateSearch: (search) => searchSchema.parse(search),
  component: ActivitiesPage,
});

function ActivitiesPage() {
  const { userId, graph, isLoading, isError, refetch } = useNetworkGraph();
  const search = Route.useSearch();

  const all = useMemo(() => (graph ? buildActivities(graph) : []), [graph]);
  const list = useMemo(() => filterActivities(all, search), [all, search]);

  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")),
    [list],
  );

  const firstContext = useMemo(() => {
    if (search.kontakt) return { contactId: search.kontakt };
    if (search.mulighet) return { opportunityId: search.mulighet };
    return null;
  }, [search]);

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterLink label="Åpne" active={search.tilstand === "apen"} to={{ tilstand: "apen" }} />
        <FilterLink label="Utførte" active={search.tilstand === "utfort"} to={{ tilstand: "utfort" }} />
        <FilterLink label="Alle" active={search.tilstand === "alle"} to={{ tilstand: "alle" }} />
        <span className="mx-1 h-4 w-px bg-border" />
        <FilterLink
          label="Forfalt"
          active={search.forfall === "forfalt"}
          to={{ tilstand: "apen", forfall: "forfalt" }}
        />
        <FilterLink
          label="Kommende"
          active={search.forfall === "kommende"}
          to={{ tilstand: "apen", forfall: "kommende" }}
        />
        {firstContext ? (
          <ActivityDialog
            context={firstContext}
            trigger={
              <Button size="sm" className="ml-auto">
                <Plus className="mr-1 h-4 w-4" /> Ny aktivitet
              </Button>
            }
          />
        ) : null}
      </div>

      <NetworkPanel title={`Aktiviteter (${sorted.length.toLocaleString("nb-NO")})`}>
        {isLoading ? (
          <PanelEmpty>Laster aktiviteter…</PanelEmpty>
        ) : sorted.length === 0 ? (
          <PanelEmpty>
            Ingen aktiviteter i dette utvalget. Aktiviteter opprettes fra en kontakt, et selskap, en
            mulighet eller en søknad.
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{a.title}</span>
                    <Badge variant="outline">{ACTIVITY_TYPE_LABEL[a.activity_type] ?? a.activity_type}</Badge>
                    <Badge variant={a.status === "utfort" ? "secondary" : "outline"}>
                      {ACTIVITY_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                    {a.isOverdue ? <Badge variant="destructive">Forfalt</Badge> : null}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {a.due_date ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {a.due_date}
                      </span>
                    ) : (
                      <span>Uten dato</span>
                    )}
                    {a.contactId ? (
                      <Link
                        to="/nettverk/kontakter/$id"
                        params={{ id: a.contactId }}
                        className="underline underline-offset-2"
                      >
                        {a.contactName ?? "Kontakt"}
                      </Link>
                    ) : null}
                    {a.opportunityId ? (
                      <Link
                        to="/nettverk/muligheter/$id"
                        params={{ id: a.opportunityId }}
                        className="underline underline-offset-2"
                      >
                        {a.opportunityTitle ?? "Mulighet"}
                      </Link>
                    ) : null}
                    {a.applicationTitle ? <span>{a.applicationTitle}</span> : null}
                    {a.companyName ? <span>{a.companyName}</span> : null}
                  </p>
                  {a.result_note ? (
                    <p className="mt-1 text-xs text-muted-foreground">Resultat: {a.result_note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ActivityStatusButton activityId={a.id} status={a.status} />
                  <ActivityDialog
                    context={{
                      contactId: a.contactId,
                      companyId: a.companyKey && a.companyKey.includes("-") ? a.companyKey : null,
                      opportunityId: a.opportunityId,
                      applicationId: a.applicationId,
                    }}
                    activity={a}
                    trigger={
                      <Button size="sm" variant="ghost">
                        Rediger
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </NetworkPanel>
    </div>
  );
}

function FilterLink({
  label,
  active,
  to,
}: {
  label: string;
  active: boolean;
  to: Record<string, string>;
}) {
  return (
    <Link
      to="/nettverk/aktiviteter"
      search={to}
      className={
        active
          ? "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
      }
    >
      {label}
    </Link>
  );
}
