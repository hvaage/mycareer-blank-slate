// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Plus } from "lucide-react";
import { ExternalUrlLink, isExternalUrl } from "@/components/external-url-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { BackLink } from "@/components/network/network-shell";
import { Timeline } from "@/components/network/timeline";
import { useAuthUserId } from "@/components/network/use-network-user";
import { ActivityDialog } from "@/components/network/activity-dialog";
import {
  buildActivities,
  buildContacts,
  companyKeyFor,
  networkGraphQuery,
} from "@/lib/queries/network";
import { buildTimeline } from "@/lib/queries/network-timeline";
import { linkDocumentToOpportunity, linkPostingContact, listPostingContacts } from "@/lib/network.functions";

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

  const timeline = useMemo(
    () => (graph ? buildTimeline(graph, { type: "opportunity", id }) : []),
    [graph, id],
  );

  const companyContacts = useMemo(() => {
    if (!graph || !opp?.card_company) return [];
    const target = opp.card_company.trim().toLowerCase();
    return buildContacts(graph).filter((c) => (c.company ?? "").trim().toLowerCase() === target);
  }, [graph, opp]);

  const documents = useMemo(
    () => (graph?.documents ?? []).filter((d) => d.opportunity_id === id),
    [graph, id],
  );

  const { data: deadline } = useQuery(deadlineQuery(userId, opp?.canonical_opportunity_id));

  if (isLoading) return <PanelEmpty>Laster mulighet…</PanelEmpty>;
  if (!opp) return <PanelEmpty>Fant ikke muligheten.</PanelEmpty>;

  const companyKey = opp.card_company ? companyKeyFor(null, opp.card_company) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:overflow-hidden">
      <div>
        <BackLink fallbackTo="/nettverk/muligheter" />
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
          <span>{opp.card_title ?? "Uten tittel"}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {opp.card_company && companyKey ? (
            <Link
              to="/nettverk/selskaper/$id"
              params={{ id: companyKey }}
              className="text-lg font-semibold underline underline-offset-2"
            >
              {opp.card_company}
            </Link>
          ) : (
            <span>{opp.card_company ?? "Ukjent selskap"}</span>
          )}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{opp.status ?? "uten status"}</Badge>
          {deadline ? <span>Søknadsfrist: {deadline}</span> : null}
          <span>
            Neste aktivitet:{" "}
            {next ? `${next.due_date ?? "uten dato"} — ${next.title}` : "Ingen planlagt"}
          </span>
          {opp.card_location ? <span>{opp.card_location}</span> : null}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-3 md:overflow-hidden">
        <NetworkPanel
          title="Annonseoversikt og neste steg"
          actions={
            <>
              <ActivityDialog
                context={{ opportunityId: id }}
                contextLabel={opp.card_title ?? "denne muligheten"}
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus className="mr-1 h-4 w-4" /> Logg aktivitet
                  </Button>
                }
              />
              {opp.card_display_url ? (
                <ExternalUrlLink
                  href={opp.card_display_url}
                  className="text-xs text-muted-foreground no-underline hover:underline"
                >
                  Åpne annonse
                </ExternalUrlLink>
              ) : null}
            </>
          }
        >
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Stilling" value={opp.card_title} />
            <Field label="Selskap" value={opp.card_company} />
            <Field label="Sted" value={opp.card_location} />
            <Field label="Status" value={opp.status} />
            <Field label="Kilde" value={opp.card_source} />
            <Field label="Søknadsfrist" value={deadline ?? "Ikke oppgitt i annonsen"} />
            <Field
              label="Neste aktivitet"
              value={
                next
                  ? `${next.due_date ?? "uten dato"} — ${next.title}${next.priority ? ` (${next.priority})` : ""}`
                  : "Ingen planlagt"
              }
            />
          </dl>
          {opp.relevance_score != null ? (
            <p className="mt-3 text-xs text-muted-foreground">
              KI-generert relevansvurdering: {opp.relevance_score}
              {opp.match_scored_model ? ` (modell ${opp.match_scored_model})` : ""}. Vurderingen er
              maskingenerert og må kontrolleres av deg.
            </p>
          ) : null}
        </NetworkPanel>

        <PostingContactPanel opportunityId={id} graph={graph} />

        <DocumentsPanel opportunityId={id} documents={documents} graph={graph} />

        <NetworkPanel title={`Dine kontakter i selskapet (${companyContacts.length})`}>
          {companyContacts.length === 0 ? (
            <PanelEmpty>Du har ingen registrerte kontakter i dette selskapet ennå.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {companyContacts.map((c) => (
                <li key={c.id} className="py-1">
                  <Link
                    to="/nettverk/kontakter/$id"
                    params={{ id: c.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.display_name}
                  </Link>
                  {c.headline ? <span className="text-muted-foreground"> · {c.headline}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </NetworkPanel>

        <NetworkPanel title={`Tidslinje (${timeline.length})`}>
          <Timeline events={timeline} />
        </NetworkPanel>

        <NetworkPanel title="Arbeidsgiverinnsikt">
          <PanelEmpty>
            Ikke analysert ennå. Arbeidsgiveranalyse vises her når en reell analyse finnes for
            selskapet.
          </PanelEmpty>
        </NetworkPanel>
      </div>
    </div>
  );
}

/**
 * Kontaktperson i annonsen. Navn, rolle og kontaktinformasjon leses av serveren
 * fra den lagrede annonsekilden. Kobling krever alltid en eksplisitt brukerhandling.
 */
function PostingContactPanel({ opportunityId, graph }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPostingContacts);
  const linkFn = useServerFn(linkPostingContact);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["posting-contacts", opportunityId],
    staleTime: 5 * 60_000,
    queryFn: () => listFn({ data: { opportunityId } }),
  });

  const linked = (graph?.postingContacts ?? []).filter((p) => p.opportunity_id === opportunityId);
  const linkedByRef = new Map(linked.map((p) => [p.source_contact_ref, p]));
  const contacts = buildContacts(graph ?? { contacts: [], relations: [], steps: [], identities: [] });

  const mutation = useMutation({
    mutationFn: async (vars: { ref: string; existingContactId: string | null }) => {
      const res = await linkFn({
        data: {
          opportunityId,
          sourceContactRef: vars.ref,
          existingContactId: vars.existingContactId,
        },
      });
      if (!res?.ok) throw new Error(res?.errorCode ?? "write_failed");
      return res;
    },
    onSuccess: () => {
      toast.success("Annonsekontakten er registrert.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => toast.error(`Kunne ikke koble kontakten (${e?.message ?? "ukjent feil"}).`),
  });

  return (
    <NetworkPanel title="Kontaktperson i annonsen">
      {isLoading ? (
        <PanelEmpty>Leser annonsekilden…</PanelEmpty>
      ) : !data?.ok || (data?.contacts ?? []).length === 0 ? (
        <PanelEmpty>Annonsen oppgir ingen kontaktperson.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {data.contacts.map((c) => {
            const existing = linkedByRef.get(c.source_contact_ref);
            const selected = choice[c.source_contact_ref] ?? "__new__";
            return (
              <li key={c.source_contact_ref} className="space-y-1 py-2">
                <div className="font-medium">
                  {existing?.network_contact_id ? (
                    <Link
                      to="/nettverk/kontakter/$id"
                      params={{ id: existing.network_contact_id }}
                      className="underline underline-offset-2"
                    >
                      {c.name ?? "Uten navn"}
                    </Link>
                  ) : (
                    (c.name ?? "Uten navn")
                  )}
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    Kilde: annonse
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[c.role, c.email, c.phone].filter(Boolean).join(" · ") || "Ingen ytterligere opplysninger i annonsen"}
                </p>
                {existing?.network_contact_id ? (
                  <p className="text-xs text-muted-foreground">Koblet til din kontaktliste.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={selected}
                      onValueChange={(v) => setChoice((s) => ({ ...s, [c.source_contact_ref]: v }))}
                    >
                      <SelectTrigger className="h-8 w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__new__">Opprett ny kontakt</SelectItem>
                        {contacts.slice(0, 200).map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          ref: c.source_contact_ref,
                          existingContactId: selected === "__new__" ? null : selected,
                        })
                      }
                    >
                      {selected === "__new__" ? "Opprett kontakt" : "Koble til kontakt"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Navnelikhet kobler aldri automatisk. Kontakten opprettes bare når du velger det.
      </p>
    </NetworkPanel>
  );
}

/** Viser kun dokumenter som faktisk er koblet til muligheten. */
function DocumentsPanel({ opportunityId, documents, graph }) {
  const queryClient = useQueryClient();
  const linkFn = useServerFn(linkDocumentToOpportunity);
  const [pick, setPick] = useState("");

  const linkable = (graph?.documents ?? []).filter((d) => !d.opportunity_id).slice(0, 200);

  const mutation = useMutation({
    mutationFn: async (documentId: string) => {
      const res = await linkFn({ data: { documentId, opportunityId } });
      if (!res?.ok) throw new Error(res?.errorCode ?? "write_failed");
    },
    onSuccess: () => {
      setPick("");
      toast.success("Dokumentet er koblet til muligheten.");
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => toast.error(`Kunne ikke koble dokumentet (${e?.message ?? "ukjent feil"}).`),
  });

  return (
    <NetworkPanel title={`Dokumenter brukt (${documents.length})`}>
      {documents.length === 0 ? (
        <PanelEmpty>Ingen dokumenter er koblet til denne muligheten ennå.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((d) => (
            <li key={d.id} className="py-1">
              <Link
                to="/soknadsdokumenter"
                className="font-medium underline-offset-2 hover:underline"
              >
                {d.title ?? "Uten tittel"}
              </Link>
              {d.document_type ? (
                <span className="text-muted-foreground"> · {d.document_type}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {linkable.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-8 w-56">
              <SelectValue placeholder="Velg dokument" />
            </SelectTrigger>
            <SelectContent>
              {linkable.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title ?? "Uten tittel"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!pick || mutation.isPending} onClick={() => mutation.mutate(pick)}>
            Koble dokument
          </Button>
        </div>
      ) : null}
    </NetworkPanel>
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
