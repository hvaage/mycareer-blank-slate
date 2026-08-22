// @ts-nocheck
/**
 * Fase 5C — én felles tidslinjemodell for selskap, kontakt og mulighet.
 * Hendelser bygges kun fra reelle rader. Ingen «typiske neste steg».
 */
import {
  ACTIVITY_TYPE_LABEL,
  buildActivities,
  type NetworkGraph,
} from "@/lib/queries/network";

export type TimelineEvent = {
  id: string;
  /** ISO-dato eller tidspunkt. Kan være null når kilden mangler dato. */
  at: string | null;
  kind: "planned" | "done";
  label: string;
  detail: string | null;
  /** Hvor hendelsen kom fra, bevart for sporbarhet. */
  source: string;
  href: { to: string; params?: Record<string, string> } | null;
};

export type TimelineScope =
  | { type: "contact"; id: string }
  | { type: "company"; key: string; name: string | null }
  | { type: "opportunity"; id: string };

function inScope(scope: TimelineScope, a: ReturnType<typeof buildActivities>[number]): boolean {
  if (scope.type === "contact") return a.contactId === scope.id;
  if (scope.type === "opportunity") return a.opportunityId === scope.id;
  return a.companyKey === scope.key || (!!scope.name && a.companyName === scope.name);
}

export function buildTimeline(graph: NetworkGraph, scope: TimelineScope): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const activities = buildActivities(graph);

  for (const a of activities) {
    if (!inScope(scope, a)) continue;
    const typeLabel = ACTIVITY_TYPE_LABEL[a.activity_type] ?? a.activity_type;
    if (a.status === "utfort") {
      events.push({
        id: `act-done-${a.id}`,
        at: a.completed_at ?? a.due_date,
        kind: "done",
        label: `${typeLabel} utført: ${a.title}`,
        detail: a.result_note,
        source: "aktivitet",
        href: { to: "/nettverk/aktiviteter" },
      });
    } else if (a.status !== "avlyst") {
      events.push({
        id: `act-plan-${a.id}`,
        at: a.due_date,
        kind: "planned",
        label: `${typeLabel} planlagt: ${a.title}`,
        detail: a.description,
        source: "aktivitet",
        href: { to: "/nettverk/aktiviteter" },
      });
    }
  }

  if (scope.type === "opportunity") {
    const opp = graph.opportunities.find((o) => o.id === scope.id);
    if (opp) {
      if (opp.created_at) {
        events.push({
          id: `opp-created-${opp.id}`,
          at: opp.created_at,
          kind: "done",
          label: "Mulighet opprettet",
          detail: opp.card_source ? `Kilde: ${opp.card_source}` : null,
          source: "user_opportunities",
          href: null,
        });
      }
      if (opp.card_published_at) {
        events.push({
          id: `opp-published-${opp.id}`,
          at: opp.card_published_at,
          kind: "done",
          label: "Annonse publisert",
          detail: opp.card_source ?? null,
          source: "annonsekilde",
          href: null,
        });
      }
    }
    for (const doc of graph.documents ?? []) {
      if (doc.opportunity_id !== scope.id) continue;
      events.push({
        id: `doc-${doc.id}`,
        at: doc.created_at ?? null,
        kind: "done",
        label: `Dokument koblet: ${doc.title ?? "Uten tittel"}`,
        detail: doc.document_type ?? null,
        source: "documents",
        href: null,
      });
    }
    for (const pc of graph.postingContacts ?? []) {
      if (pc.opportunity_id !== scope.id) continue;
      events.push({
        id: `pc-${pc.id}`,
        at: pc.observed_at ?? null,
        kind: "done",
        label: `Annonsekontakt registrert: ${pc.contact_name ?? "uten navn"}`,
        detail: "Kilde: jobbannonse",
        source: "job_posting",
        href: pc.network_contact_id
          ? { to: "/nettverk/kontakter/$id", params: { id: pc.network_contact_id } }
          : null,
      });
    }
  }

  if (scope.type === "contact") {
    const contact = graph.contacts.find((c) => c.id === scope.id);
    if (contact?.connected_on) {
      events.push({
        id: `contact-connected-${contact.id}`,
        at: contact.connected_on,
        kind: "done",
        label: "Kontakt registrert i nettverket",
        detail: contact.source_system ? `Kilde: ${contact.source_system}` : null,
        source: "network_contacts",
        href: null,
      });
    }
  }

  return events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export function formatEventDate(at: string | null): string {
  if (!at) return "Uten dato";
  return at.slice(0, 10);
}
