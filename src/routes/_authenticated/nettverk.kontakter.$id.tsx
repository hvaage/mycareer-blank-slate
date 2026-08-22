// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { Timeline } from "@/components/network/timeline";
import { ExternalUrlLink } from "@/components/external-url-link";
import { ActivityDialog, ActivityStatusButton } from "@/components/network/activity-dialog";
import { BackLink } from "@/components/network/network-shell";
import { useNetworkGraph } from "@/components/network/use-network-user";
import { NetworkErrorState } from "@/components/network/network-error";
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  buildActivities,
  buildContacts,
  companyKeyFor,
  networkGraphQuery,
} from "@/lib/queries/network";
import { buildTimeline } from "@/lib/queries/network-timeline";
import { setContactCompanyRelation, updateContactManualFields } from "@/lib/network.functions";

export const Route = createFileRoute("/_authenticated/nettverk/kontakter/$id")({
  component: ContactDetail,
});

function ContactDetail() {
  const { id } = Route.useParams();
  const { userId, graph, isLoading, isError, refetch } = useNetworkGraph();

  const contact = useMemo(
    () => (graph ? buildContacts(graph).find((c) => c.id === id) ?? null : null),
    [graph, id],
  );
  const activities = useMemo(
    () => (graph ? buildActivities(graph).filter((a) => a.contactId === id) : []),
    [graph, id],
  );
  const timeline = useMemo(
    () => (graph ? buildTimeline(graph, { type: "contact", id }) : []),
    [graph, id],
  );
  /**
   * Muligheter der kontakten faktisk er koblet: enten som registrert annonsekontakt,
   * eller via en aktivitet brukeren selv har knyttet til både kontakt og mulighet.
   */
  const opportunities = useMemo(() => {
    if (!graph) return [];
    const ids = new Set<string>();
    for (const pc of graph.postingContacts ?? []) {
      if (pc.network_contact_id === id && pc.opportunity_id) ids.add(pc.opportunity_id);
    }
    for (const a of activities) {
      if (a.opportunityId) ids.add(a.opportunityId);
    }
    return graph.opportunities.filter((o) => ids.has(o.id));
  }, [graph, id, activities]);

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;
  if (isLoading) return <p className="p-2 text-sm text-muted-foreground">Laster kontakt…</p>;
  if (!contact) return <p className="p-2 text-sm text-muted-foreground">Fant ikke kontakten.</p>;

  const companyKey = contact.company ? companyKeyFor(contact.companyId, contact.company) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div>
        <BackLink fallbackTo="/nettverk/kontakter" />
        <h2 className="text-lg font-semibold">{contact.display_name}</h2>
        <p className="text-sm text-muted-foreground">
          {contact.headline ?? "Tittel ikke registrert"}
          {contact.company ? " · " : ""}
          {contact.company && companyKey ? (
            <Link
              to="/nettverk/selskaper/$id"
              params={{ id: companyKey }}
              className="underline underline-offset-2"
            >
              {contact.company}
            </Link>
          ) : null}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-3 md:overflow-hidden">
        <NetworkPanel title="Kontaktprofil og kontaktkanaler">
          <dl className="space-y-1">
            <Row label="Navn" value={contact.display_name} source={contact.nameSource} />
            <Row label="Tittel" value={contact.headline} source={contact.headlineSource} />
            <Row label="Selskap" value={contact.company} source={contact.companySource} />
            <Row
              label="Koblet"
              value={
                contact.connected_on
                  ? new Date(contact.connected_on).toLocaleDateString("nb-NO")
                  : null
              }
            />
            <Row label="Kilde" value={contact.source_system === "linkedin_import" ? "LinkedIn-import" : contact.source_system} />
          </dl>

          <div className="mt-3 rounded-md border border-border p-2">
            <p className="text-xs font-medium">Observert i LinkedIn</p>
            <dl className="mt-1 space-y-1 text-xs text-muted-foreground">
              <Row label="Navn" value={contact.linkedinDisplayName} />
              <Row label="Tittel" value={contact.linkedinHeadline} />
              <Row label="Selskap" value={contact.linkedinCompany} />
              <Row
                label="Sist observert"
                value={
                  contact.linkedinObservedAt
                    ? new Date(contact.linkedinObservedAt).toLocaleDateString("nb-NO")
                    : null
                }
              />
            </dl>
            {contact.linkedinProfileUrl ? (
              <ExternalUrlLink href={contact.linkedinProfileUrl} className="mt-1 text-xs">
                Åpne LinkedIn-profil
              </ExternalUrlLink>
            ) : null}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            E-post og telefon vises kun når du selv har lagt dem inn i produktet.
          </p>
        </NetworkPanel>

        <ManualFieldsPanel contact={contact} />


        <NetworkPanel title={`Muligheter (${opportunities.length})`}>
          {opportunities.length === 0 ? (
            <PanelEmpty>Kontakten er ikke koblet til noen mulighet ennå.</PanelEmpty>
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
                  <span className="text-muted-foreground"> · {o.card_company}</span>
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel
          title={`Aktiviteter (${activities.length})`}
          actions={
            <ActivityDialog
              context={{ contactId: contact.id, companyId: contact.companyId ?? null }}
              contextLabel={contact.display_name}
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="mr-1 h-4 w-4" /> Logg aktivitet
                </Button>
              }
            />
          }
        >
          {activities.length === 0 ? (
            <PanelEmpty>Ingen aktiviteter registrert på kontakten.</PanelEmpty>
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

        <NetworkPanel title="Tredjepartsinformasjon">
          <PanelEmpty>
            Mottatte LinkedIn-anbefalinger vises her kun når du selv har koblet dem til denne
            kontakten. Slik informasjon er tredjepartsinformasjon, ikke dokumentert CV-evidens.
          </PanelEmpty>
        </NetworkPanel>
      </div>
    </div>
  );
}

/**
 * Manuelle verdier vinner alltid over LinkedIn-observasjoner. Tomt felt
 * tilbakestiller til observert verdi. All skriving går via kanonisk serverhandling.
 */
function ManualFieldsPanel({ contact }) {
  const queryClient = useQueryClient();
  const saveFields = useServerFn(updateContactManualFields);
  const saveRelation = useServerFn(setContactCompanyRelation);
  const [name, setName] = useState(contact.nameSource === "user_input" ? contact.display_name : "");
  const [headline, setHeadline] = useState(
    contact.headlineSource === "user_input" ? (contact.headline ?? "") : "",
  );
  const [company, setCompany] = useState(
    contact.companySource === "user_input" ? (contact.company ?? "") : "",
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
  }, [contact.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      const fields = await saveFields({
        data: {
          contactId: contact.id,
          displayName: name.trim() || null,
          headline: headline.trim() || null,
        },
      });
      if (!fields?.ok) throw new Error(fields?.errorCode ?? "write_failed");
      const relation = await saveRelation({
        data: {
          contactId: contact.id,
          companyName: company.trim() || null,
          relationKind: "unknown",
        },
      });
      if (!relation?.ok) throw new Error(relation?.errorCode ?? "write_failed");
    },
    onSuccess: () => {
      setStatus("Lagret. Dine verdier vises nå framfor LinkedIn-dataene.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: () => setStatus("Kunne ikke lagre. Ingen endringer ble gjort."),
  });

  return (
    <NetworkPanel title="Dine egne opplysninger">
      <div className="space-y-2">
        <Field id="manual-name" label="Navn" value={name} onChange={setName} placeholder={contact.linkedinDisplayName ?? ""} />
        <Field
          id="manual-headline"
          label="Tittel"
          value={headline}
          onChange={setHeadline}
          placeholder={contact.linkedinHeadline ?? ""}
        />
        <Field
          id="manual-company"
          label="Selskap"
          value={company}
          onChange={setCompany}
          placeholder={contact.linkedinCompany ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Tomt felt bruker den observerte LinkedIn-verdien. En ny LinkedIn-import overskriver ikke
          det du har lagt inn her.
        </p>
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Lagrer…" : "Lagre"}
        </Button>
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </div>
    </NetworkPanel>
  );
}

function Field({ id, label, value, onChange, placeholder }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}

function Row({
  label,
  value,
  source,
}: {
  label: string;
  value: string | null | undefined;
  source?: "user_input" | "linkedin_observed";
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">
        {value || "Ikke registrert"}
        {value && source ? (
          <Badge variant="outline" className="ml-2 text-[10px]">
            {source === "user_input" ? "Din registrering" : "LinkedIn"}
          </Badge>
        ) : null}
      </dd>
    </div>
  );
}

