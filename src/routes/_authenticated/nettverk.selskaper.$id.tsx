// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { SuggestionPanel } from "@/components/network/suggestion-panel";
import { Timeline } from "@/components/network/timeline";
import { ActivityDialog, ActivityStatusButton } from "@/components/network/activity-dialog";
import { Plus } from "lucide-react";
import { BackLink } from "@/components/network/network-shell";
import { useNetworkGraph } from "@/components/network/use-network-user";
import { NetworkErrorState } from "@/components/network/network-error";
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  buildActivities,
  buildCompanies,
  buildContacts,
  isCompanyIdKey,
  networkGraphQuery,
} from "@/lib/queries/network";
import { buildTimeline } from "@/lib/queries/network-timeline";
import { setCompanyRelationship } from "@/lib/network.functions";
import { PRIORITY_LABEL, STATUS_LABEL } from "./nettverk.selskaper.index";

export const Route = createFileRoute("/_authenticated/nettverk/selskaper/$id")({
  component: CompanyDetail,
});

const NONE = "__none__";

function CompanyDetail() {
  const { id } = Route.useParams();
  const { userId, graph, isLoading, isError, refetch } = useNetworkGraph();
  const queryClient = useQueryClient();
  const save = useServerFn(setCompanyRelationship);

  const company = useMemo(
    () => (graph ? buildCompanies(graph).find((c) => c.key === id) ?? null : null),
    [graph, id],
  );
  const contacts = useMemo(() => {
    if (!graph || !company) return [];
    const target = company.name.trim().toLowerCase();
    const relContactIds = new Set(
      graph.relations
        .filter(
          (r) =>
            (company.companyId && r.company_id === company.companyId) ||
            (r.company_name_observed ?? "").trim().toLowerCase() === target,
        )
        .map((r) => r.network_contact_id),
    );
    return buildContacts(graph).filter(
      (c) => relContactIds.has(c.id) || (c.company ?? "").trim().toLowerCase() === target,
    );
  }, [graph, company]);
  const opportunities = useMemo(() => {
    if (!graph || !company) return [];
    const target = company.name.trim().toLowerCase();
    return graph.opportunities.filter(
      (o) => (o.card_company ?? "").trim().toLowerCase() === target,
    );
  }, [graph, company]);
  const activities = useMemo(() => {
    if (!graph || !company) return [];
    return buildActivities(graph).filter(
      (a) => a.companyKey === company.key || (!!a.companyName && a.companyName === company.name),
    );
  }, [graph, company]);
  const nextActivity = activities
    .filter((a) => a.isOpen)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0];
  const timeline = useMemo(
    () =>
      graph && company
        ? buildTimeline(graph, { type: "company", key: company.key, name: company.name })
        : [],
    [graph, company],
  );

  const [status, setStatus] = useState<string>(NONE);
  const [priority, setPriority] = useState<string>(NONE);
  useEffect(() => {
    setStatus(company?.status ?? NONE);
    setPriority(company?.priority ?? NONE);
  }, [company?.key, company?.status, company?.priority]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!company?.companyId) throw new Error("Selskapet mangler oppføring i selskapsregisteret.");
      return save({
        data: {
          companyId: company.companyId,
          companyName: company.name,
          status: status === NONE ? null : status,
          priority: priority === NONE ? null : priority,
        },
      });
    },
    onSuccess: (result: any) => {
      if (!result?.ok) {
        toast.error(`Kunne ikke lagre (${result?.errorCode ?? "ukjent feil"}).`);
        return;
      }
      toast.success("Selskapsforholdet er oppdatert.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunne ikke lagre."),
  });

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;
  if (isLoading) return <p className="p-2 text-sm text-muted-foreground">Laster selskap…</p>;
  if (!company) return <p className="p-2 text-sm text-muted-foreground">Fant ikke selskapet.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div>
        <BackLink fallbackTo="/nettverk/selskaper" />
        <h2 className="text-lg font-semibold">{company.name}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {[company.industry, company.location].filter(Boolean).join(" · ") ||
              "Bransje og sted ikke registrert"}
          </span>
          {company.status ? <span>Status: {STATUS_LABEL[company.status] ?? company.status}</span> : null}
          {company.priority ? (
            <span>Prioritet: {PRIORITY_LABEL[company.priority] ?? company.priority}</span>
          ) : null}
          <span>Dine kontakter i selskapet: {contacts.length}</span>
          <span>Aktive muligheter: {company.openOpportunityCount}</span>
          <span>
            Neste aktivitet:{" "}
            {nextActivity
              ? `${nextActivity.due_date ?? "uten dato"} — ${nextActivity.title}`
              : "Ingen planlagt"}
          </span>
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-3 md:overflow-hidden">
        <NetworkPanel title="Selskapsprofil">
          <dl className="space-y-1">
            <Row label="Navn" value={company.name} />
            <Row label="Bransje" value={company.industry} />
            <Row label="Sted" value={company.location} />
            <Row label="Kilder" value={company.sources.join(", ")} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Registerdata som organisasjonsform, ansatte og nøkkeltall vises først når de finnes i
            grunnlaget ditt. Manglende felt vises som «Ikke registrert», aldri som null.
          </p>
        </NetworkPanel>


        <NetworkPanel title="Ditt selskapsforhold">
          {!isCompanyIdKey(company.key) ? (
            <PanelEmpty>
              Selskapet er kjent gjennom navn fra dine kontakter eller muligheter. Status og
              prioritet kan settes når selskapet finnes i selskapsregisteret.
            </PanelEmpty>
          ) : (
            <div className="space-y-2">
              <LabeledSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={STATUS_LABEL}
              />
              <LabeledSelect
                label="Prioritet"
                value={priority}
                onChange={setPriority}
                options={PRIORITY_LABEL}
              />
              <Button
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                Lagre
              </Button>
              <p className="text-xs text-muted-foreground">
                Verdiene settes kun av deg og fylles aldri automatisk fra importerte data.
              </p>
            </div>
          )}
        </NetworkPanel>

        <NetworkPanel title="Arbeidsgiverinnsikt">
          <PanelEmpty>
            Ikke analysert ennå. Her vises kun reelle analyseresultater for selskapet.
          </PanelEmpty>
        </NetworkPanel>

        <NetworkPanel title={`Dine kontakter i selskapet (${contacts.length})`}>
          {contacts.length === 0 ? (
            <PanelEmpty>Du har ingen registrerte kontakter i dette selskapet ennå.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.id} className="py-1">
                  <Link
                    to="/nettverk/kontakter/$id"
                    params={{ id: c.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.display_name}
                  </Link>
                  {c.headline ? (
                    <span className="text-muted-foreground"> · {c.headline}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Muligheter (${opportunities.length})`}>
          {opportunities.length === 0 ? (
            <PanelEmpty>Ingen muligheter registrert på selskapet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {opportunities.map((o) => (
                <li key={o.id} className="py-1">
                  <Link
                    to="/nettverk/muligheter/$id"
                    params={{ id: o.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {o.card_title ?? "Uten tittel"}
                  </Link>
                  {o.status ? (
                    <span className="text-muted-foreground"> · {o.status}</span>
                  ) : null}
                  {o.relevance_score != null ? (
                    <span className="text-muted-foreground"> · match {o.relevance_score}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel
          title={`Aktiviteter (${activities.length})`}
          actions={
            <ActivityDialog
              context={{ companyId: isCompanyIdKey(company.key) ? company.key : null }}
              contextLabel={company.name}
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="mr-1 h-4 w-4" /> Logg aktivitet
                </Button>
              }
            />
          }
        >
          {activities.length === 0 ? (
            <PanelEmpty>Ingen aktiviteter registrert på selskapet.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {activities.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-1">
                  <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {a.due_date ?? "Uten dato"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.title}
                    <span className="text-muted-foreground">
                      {" "}
                      · {ACTIVITY_TYPE_LABEL[a.activity_type] ?? a.activity_type} ·{" "}
                      {ACTIVITY_STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </span>
                  <ActivityStatusButton activityId={a.id} status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Tidslinje (${timeline.length})`}>
          <Timeline events={timeline} />
        </NetworkPanel>

        <SuggestionPanel scope="company" scopeObjectId={id} context={{ companyId: id }} />



      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="Ikke satt" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Ikke satt</SelectItem>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || "Ikke registrert"}</dd>
    </div>
  );
}
