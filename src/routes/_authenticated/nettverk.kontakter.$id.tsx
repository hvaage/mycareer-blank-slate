// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { BackLink } from "@/components/network/network-shell";
import { useAuthUserId } from "@/components/network/use-network-user";
import { buildContacts, companyKeyFor, networkGraphQuery } from "@/lib/queries/network";
import { setContactCompanyRelation, updateContactManualFields } from "@/lib/network.functions";

export const Route = createFileRoute("/_authenticated/nettverk/kontakter/$id")({
  component: ContactDetail,
});

function ContactDetail() {
  const { id } = Route.useParams();
  const userId = useAuthUserId();
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));

  const contact = useMemo(
    () => (graph ? buildContacts(graph).find((c) => c.id === id) ?? null : null),
    [graph, id],
  );
  const steps = useMemo(
    () => (graph ? graph.steps.filter((s) => s.contact_id === id) : []),
    [graph, id],
  );
  const opportunities = useMemo(() => {
    if (!graph || !contact?.company) return [];
    const target = contact.company.trim().toLowerCase();
    return graph.opportunities.filter(
      (o) => (o.card_company ?? "").trim().toLowerCase() === target,
    );
  }, [graph, contact]);

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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-2 md:overflow-hidden">
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
              <a
                href={contact.linkedinProfileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2"
              >
                Åpne LinkedIn-profil <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            E-post og telefon vises kun når du selv har lagt dem inn i produktet.
          </p>
        </NetworkPanel>

        <ManualFieldsPanel contact={contact} />


        <NetworkPanel title={`Relevante muligheter (${opportunities.length})`}>
          {opportunities.length === 0 ? (
            <PanelEmpty>Ingen muligheter knyttet til denne kontaktens selskap.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {opportunities.map((o) => (
                <li key={o.id} className="py-1">
                  <span className="font-medium">{o.card_title ?? "Uten tittel"}</span>
                  <span className="text-muted-foreground"> · {o.card_company}</span>
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Aktiviteter og tidslinje (${steps.length})`}>
          {steps.length === 0 ? (
            <PanelEmpty>Ingen aktiviteter registrert på kontakten.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-2 py-1">
                  <span className="tabular-nums text-muted-foreground">
                    {s.due_date ? new Date(s.due_date).toLocaleDateString("nb-NO") : "—"}
                  </span>
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || "Ikke registrert"}</dd>
    </div>
  );
}
