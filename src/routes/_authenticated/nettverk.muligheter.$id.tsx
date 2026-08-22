// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useAuthUserId } from "@/components/network/use-network-user";
import { ActivityDialog, ActivityStatusButton } from "@/components/network/activity-dialog";
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  buildActivities,
  networkGraphQuery,
} from "@/lib/queries/network";

export const Route = createFileRoute("/_authenticated/nettverk/muligheter/$id")({
  component: OpportunityDetail,
});

/** Leser en reell søknadsfrist fra annonsegrunnlaget. Finnes den ikke, vises ingenting. */
function deadlineQuery(userId: string | undefined, canonicalId: string | null | undefined) {
  return {
    queryKey: ["opportunity-deadline", userId, canonicalId],
    enabled: !!userId && !!canonicalId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data, error } = await supabase
        .from("source_postings")
        .select("raw_payload")
        .eq("canonical_opportunity_id", canonicalId!)
        .limit(5);
      if (error) throw error;
      for (const row of data ?? []) {
        const p = (row.raw_payload ?? {}) as Record<string, unknown>;
        for (const key of ["application_deadline", "søknadsfrist", "soknadsfrist", "deadline", "applicationDue"]) {
          const v = p[key];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
      }
      return null;
    },
  };
}

function OpportunityDetail() {
  const { id } = Route.useParams();
  const userId = useAuthUserId();
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));

  const opp = useMemo(() => graph?.opportunities.find((o) => o.id === id) ?? null, [graph, id]);
  const activities = useMemo(
    () => (graph ? buildActivities(graph).filter((a) => a.opportunityId === id) : []),
    [graph, id],
  );
  const next = activities
    .filter((a) => a.isOpen)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0];

  const { data: deadline } = useQuery(deadlineQuery(userId, opp?.canonical_opportunity_id));

  if (isLoading) return <PanelEmpty>Laster mulighet…</PanelEmpty>;
  if (!opp) return <PanelEmpty>Fant ikke muligheten.</PanelEmpty>;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Link
        to="/nettverk/muligheter"
        search={{ tilstand: "apen" }}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Tilbake til muligheter
      </Link>

      <NetworkPanel
        title={opp.card_title ?? "Uten tittel"}
        actions={
          opp.card_display_url ? (
            <a
              href={opp.card_display_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              Åpne annonse <ExternalLink className="h-3 w-3" />
            </a>
          ) : null
        }
      >
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Field label="Selskap" value={opp.card_company} />
          <Field label="Sted" value={opp.card_location} />
          <Field label="Status" value={opp.status} />
          <Field label="Kilde" value={opp.card_source} />
          <Field
            label="Neste aktivitet"
            value={next ? `${next.due_date ?? "uten dato"} — ${next.title}` : "Ingen planlagt"}
          />
          {deadline ? <Field label="Søknadsfrist" value={deadline} /> : null}
        </dl>
        {opp.relevance_score != null ? (
          <p className="mt-3 text-xs text-muted-foreground">
            KI-generert relevansvurdering: {opp.relevance_score}
            {opp.match_scored_model ? ` (modell ${opp.match_scored_model})` : ""}. Vurderingen er
            maskingenerert og må kontrolleres av deg.
          </p>
        ) : null}
      </NetworkPanel>

      <NetworkPanel
        title={`Aktiviteter (${activities.length})`}
        actions={
          <ActivityDialog
            context={{ opportunityId: id }}
            contextLabel={opp.card_title ?? "denne muligheten"}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" /> Ny aktivitet
              </Button>
            }
          />
        }
      >
        {activities.length === 0 ? (
          <PanelEmpty>Ingen aktiviteter knyttet til denne muligheten.</PanelEmpty>
        ) : (
          <ul className="divide-y divide-border">
            {activities.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{a.title}</span>
                    <Badge variant="outline">{ACTIVITY_TYPE_LABEL[a.activity_type] ?? a.activity_type}</Badge>
                    <Badge variant={a.status === "utfort" ? "secondary" : "outline"}>
                      {ACTIVITY_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.due_date ?? "Uten dato"}</p>
                </div>
                <ActivityStatusButton activityId={a.id} status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </NetworkPanel>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value || "—"}</dd>
    </div>
  );
}
