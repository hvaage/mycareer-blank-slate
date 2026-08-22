// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { SuggestionPanel } from "@/components/network/suggestion-panel";
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
import {
  linkRecommendationToContact,
  setContactCompanyRelation,
  updateContactContactPoints,
  updateContactManualFields,
} from "@/lib/network.functions";

const RELATION_STATUS_LABEL: Record<string, string> = {
  ukjent: "Ukjent",
  varm: "Varm",
  aktiv: "Aktiv dialog",
  referanse: "Referanse",
  ikke_aktuell: "Ikke aktuell",
};

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

  /** Observerte kontaktpunkter fra annonser leses kun fra serverdata, aldri fra klientinput. */
  const observedPoints = useMemo(
    () =>
      (graph?.postingContacts ?? []).filter(
        (pc) => pc.network_contact_id === id && (pc.contact_email || pc.contact_phone),
      ),
    [graph, id],
  );
  const recommendations = useMemo(() => graph?.recommendations ?? [], [graph]);

  if (isError) return <NetworkErrorState onRetry={() => refetch()} />;
  if (isLoading) return <p className="p-2 text-sm text-muted-foreground">Laster kontakt…</p>;
  if (!contact) return <p className="p-2 text-sm text-muted-foreground">Fant ikke kontakten.</p>;

  const companyKey = contact.company ? companyKeyFor(contact.companyId, contact.company) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <BackLink fallbackTo="/nettverk/kontakter" />
        <h2 className="text-base font-semibold leading-tight">{contact.display_name}</h2>
        <p className="text-xs text-muted-foreground">
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
          {contact.manualRelationStatus
            ? ` · ${RELATION_STATUS_LABEL[contact.manualRelationStatus]}`
            : ""}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3 md:auto-rows-[minmax(240px,1fr)] md:overflow-y-auto">

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
            <Row
              label="Din relasjon"
              value={
                contact.manualRelationStatus
                  ? RELATION_STATUS_LABEL[contact.manualRelationStatus]
                  : null
              }
              source={contact.manualRelationStatus ? "user_input" : undefined}
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

        <ContactPointsPanel contact={contact} observed={observedPoints} />

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

        <SuggestionPanel scope="contact" scopeObjectId={id} context={{ contactId: id }} />



        <RecommendationsPanel contactId={contact.id} recommendations={recommendations} />
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
  const [notes, setNotes] = useState(contact.manualNotes ?? "");
  const [relationStatus, setRelationStatus] = useState(contact.manualRelationStatus ?? "ukjent");
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
          notes: notes.trim() || null,
          relationStatus: relationStatus === "ukjent" ? null : relationStatus,
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
        <div className="space-y-1">
          <Label className="text-xs">Din relasjon</Label>
          <Select value={relationStatus} onValueChange={setRelationStatus}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RELATION_STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="manual-notes" className="text-xs">
            Notater
          </Label>
          <Textarea
            id="manual-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Dine egne notater om relasjonen"
          />
        </div>
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

/**
 * Kontaktpunkter er brukerens egne verdier. Observasjoner fra stillingsannonser
 * vises som sekundær kilde med opphav, og kopieres aldri automatisk.
 */
function ContactPointsPanel({ contact, observed }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateContactContactPoints);
  const [email, setEmail] = useState(contact.manualEmail ?? "");
  const [phone, setPhone] = useState(contact.manualPhone ?? "");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setEmail(contact.manualEmail ?? "");
    setPhone(contact.manualPhone ?? "");
    setStatus(null);
  }, [contact.id, contact.manualEmail, contact.manualPhone]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await save({
        data: { contactId: contact.id, email: email.trim() || null, phone: phone.trim() || null },
      });
      if (!res?.ok) throw new Error(res?.errorCode ?? "write_failed");
      return res;
    },
    onSuccess: () => {
      setStatus("Lagret.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (err: Error) =>
      setStatus(
        err.message === "invalid_email"
          ? "E-postadressen ser ikke gyldig ut. Ingen endring ble lagret."
          : err.message === "invalid_phone"
            ? "Telefonnummeret ser ikke gyldig ut. Ingen endring ble lagret."
            : "Kunne ikke lagre. Ingen endringer ble gjort.",
      ),
  });

  return (
    <NetworkPanel title="Kontaktpunkter">
      <dl className="space-y-0.5">
        <Row label="E-post" value={contact.manualEmail} source={contact.manualEmail ? "user_input" : undefined} />
        <Row label="Telefon" value={contact.manualPhone} source={contact.manualPhone ? "user_input" : undefined} />
      </dl>

      <div className="mt-2 space-y-2">
        <Field id="contact-email" label="E-post" value={email} onChange={setEmail} placeholder="" />
        <Field id="contact-phone" label="Telefon" value={phone} onChange={setPhone} placeholder="" />
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Lagrer…" : "Lagre kontaktpunkter"}
        </Button>
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </div>

      <div className="mt-2 rounded-md border border-border p-2">
        <p className="text-xs font-medium">Fra jobbannonse</p>
        {observed.length === 0 ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ingen kontaktpunkter observert i annonser.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {observed.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-1">
                <span>{[o.contact_email, o.contact_phone].filter(Boolean).join(" · ")}</span>
                {o.contact_role ? <span>· {o.contact_role}</span> : null}
                <Badge variant="outline" className="text-[10px]">
                  Fra jobbannonse
                </Badge>
                {o.observed_at ? (
                  <span>· observert {new Date(o.observed_at).toLocaleDateString("nb-NO")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Observasjoner fylles aldri inn i dine egne felt automatisk.
        </p>
      </div>
    </NetworkPanel>
  );

}

/**
 * Mottatte LinkedIn-anbefalinger er tredjepartsinformasjon. De kobles kun til en
 * kontakt ved eksplisitt brukerhandling — aldri på navnelikhet.
 */
function RecommendationsPanel({ contactId, recommendations }) {
  const queryClient = useQueryClient();
  const link = useServerFn(linkRecommendationToContact);
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);

  const linked = recommendations.filter((r) => r.network_contact_id === contactId);
  const available = recommendations.filter((r) => !r.network_contact_id);

  const mutation = useMutation({
    mutationFn: async (input: { recommendationId: string; contactId: string | null }) => {
      const res = await link({ data: input });
      if (!res?.ok) throw new Error(res?.errorCode ?? "write_failed");
    },
    onSuccess: () => {
      setSelected("");
      setStatus(null);
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: () => setStatus("Kunne ikke oppdatere koblingen. Ingen endringer ble gjort."),
  });

  return (
    <NetworkPanel title={`Anbefalinger (${linked.length})`}>
      {linked.length === 0 ? (
        <PanelEmpty>
          Mottatte LinkedIn-anbefalinger vises her kun når du selv har koblet dem til denne
          kontakten. Slik informasjon er tredjepartsinformasjon, ikke dokumentert CV-evidens.
        </PanelEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {linked.map((r) => (
            <li key={r.id} className="py-2">
              <p className="text-sm font-medium">
                {r.author_name ?? "Ukjent avsender"}
                <Badge variant="outline" className="ml-2 text-[10px]">
                  Tredjepart
                </Badge>
              </p>
              {r.author_title || r.author_company ? (
                <p className="text-xs text-muted-foreground">
                  {[r.author_title, r.author_company].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {r.recommendation_text ? (
                <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                  {r.recommendation_text}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2 text-xs"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ recommendationId: r.id, contactId: null })}
              >
                Fjern kobling
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-border pt-2">
          <Label className="text-xs">Koble en mottatt anbefaling til denne kontakten</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Velg anbefaling" />
            </SelectTrigger>
            <SelectContent>
              {available.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.author_name ?? "Ukjent avsender"}
                  {r.recommended_on ? ` · ${r.recommended_on}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || mutation.isPending}
            onClick={() => mutation.mutate({ recommendationId: selected, contactId })}
          >
            Koble til kontakten
          </Button>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        </div>
      ) : null}
    </NetworkPanel>
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

