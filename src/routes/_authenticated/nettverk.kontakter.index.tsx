// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import { useAuthUserId } from "@/components/network/use-network-user";
import { buildContacts, networkBatchQuery, networkGraphQuery } from "@/lib/queries/network";

export const Route = createFileRoute("/_authenticated/nettverk/kontakter/")({
  component: ContactsPage,
});

const OBJECT_KIND_LABEL: Record<string, string> = {
  person_contact: "Personkontakter",
  company_observation: "Selskapsobservasjoner",
  network_event: "Nettverksarrangementer",
  network_preference_signal: "Preferansesignaler",
  invitation: "Invitasjoner uten avklart identitet",
  ukjent: "Uklassifisert",
};

const CONTACTS_PER_PAGE = 100;

function ContactsPage() {
  const userId = useAuthUserId();
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const { data: graph, isLoading } = useQuery(networkGraphQuery(userId));
  const { data: batchData } = useQuery(networkBatchQuery(userId));

  const contacts = useMemo(() => (graph ? buildContacts(graph) : []), [graph]);
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.display_name.toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q) ||
        (c.headline ?? "").toLowerCase().includes(q),
    );
  }, [contacts, term]);

  useEffect(() => {
    setPage(0);
  }, [term]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / CONTACTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * CONTACTS_PER_PAGE;
  const visibleContacts = filtered.slice(pageStart, pageStart + CONTACTS_PER_PAGE);
  const title = term.trim()
    ? `Kontakter (${filtered.length.toLocaleString("nb-NO")} av ${contacts.length.toLocaleString("nb-NO")})`
    : `Kontakter (${contacts.length.toLocaleString("nb-NO")})`;

  const importablePersons =
    batchData?.state === "importable" ? (batchData.pendingPersonItemIds?.length ?? 0) : 0;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3 md:overflow-hidden">
      <NetworkPanel
        title={title}
        className="md:col-span-2"
        actions={
          contacts.length > 0 ? (
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Filtrer"
              className="h-8 w-36 md:w-52"
              aria-label="Filtrer kontakter"
            />
          ) : null
        }
      >
        {isLoading ? (
          <PanelEmpty>Laster kontakter…</PanelEmpty>
        ) : contacts.length === 0 ? (
          <div className="max-w-xl space-y-3 py-2">
            <h3 className="text-base font-semibold">Importer nettverket ditt fra LinkedIn</h3>
            {importablePersons > 0 ? (
              <p className="text-sm">
                Vi har funnet{" "}
                <span className="font-medium tabular-nums">
                  {importablePersons.toLocaleString("nb-NO")}
                </span>{" "}
                personkontakter i eksporten din.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Vi finner ingen gyldig LinkedIn-gjennomgang å importere fra ennå.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Kontaktene opprettes først når du bekrefter importen. LinkedIn-data overskriver ikke
              senere manuelle rettinger.
            </p>
            <div className="flex flex-wrap gap-2">
              {importablePersons > 0 ? (
                <Button asChild size="sm" className="gap-2">
                  <Link to="/nettverk/kontakter/import">
                    <Users className="h-4 w-4" aria-hidden />
                    Gå gjennom og importer kontakter
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="ghost">
                <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
                  Se kildegjennomgang
                </Link>
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <PanelEmpty>Ingen kontakter treffer filteret.</PanelEmpty>
        ) : (
          <div className="flex min-h-0 flex-col">
          <ul className="divide-y divide-border">
            {visibleContacts.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    to="/nettverk/kontakter/$id"
                    params={{ id: c.id }}
                    className="font-medium hover:underline"
                  >
                    {c.display_name}
                  </Link>
                  {c.headline ? (
                    <span className="text-muted-foreground">{c.headline}</span>
                  ) : null}
                  {c.company ? <Badge variant="secondary">{c.company}</Badge> : null}
                  {c.linkedinProfileUrl ? (
                    <ExternalUrlLink
                      href={c.linkedinProfileUrl}
                      className="text-xs text-muted-foreground"
                    >
                      LinkedIn
                    </ExternalUrlLink>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {c.nextActivity
                      ? `Neste: ${c.nextActivity.title}`
                      : c.lastContactAt
                        ? `Sist kontakt: ${new Date(c.lastContactAt).toLocaleDateString("nb-NO")}`
                        : "Ingen aktivitet"}
                  </span>
                </div>
                {c.linkedinObservedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Sist observert i LinkedIn:{" "}
                    {new Date(c.linkedinObservedAt).toLocaleDateString("nb-NO")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
            {filtered.length > CONTACTS_PER_PAGE ? (
              <div className="sticky bottom-0 mt-2 flex items-center justify-between gap-2 border-t border-border bg-card pt-2 text-xs text-muted-foreground">
                <span>
                  Viser {pageStart + 1}–{Math.min(pageStart + CONTACTS_PER_PAGE, filtered.length)} av {" "}
                  {filtered.length.toLocaleString("nb-NO")}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    disabled={currentPage === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                    aria-label="Forrige kontaktside"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </Button>
                  <span className="min-w-12 text-center tabular-nums">
                    {currentPage + 1} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                    aria-label="Neste kontaktside"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </NetworkPanel>

      <NetworkPanel title="Kildeimport: nettverksbatch">
        {!batchData || batchData.state === "none" ? (
          <PanelEmpty>Ingen klar nettverksbatch til gjennomgang.</PanelEmpty>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {batchData.state === "importable"
                ? "Batch fra LinkedIn-import, status «klar». Ingenting er lagt til i registeret ditt før du bekrefter."
                : batchData.state === "consumed"
                  ? "Kontaktene fra denne importen er allerede lagt til."
                  : "Denne importen er erstattet av en nyere gjennomgang."}
            </p>
            <ul className="space-y-1">
              {Object.entries(batchData.objectKindCounts).map(([kind, count]) => (
                <li key={kind} className="flex items-baseline justify-between gap-2">
                  <span>{OBJECT_KIND_LABEL[kind] ?? kind}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-md border border-border p-2 text-xs text-muted-foreground">
              Kun personkontakter kan legges til som kontakter. Selskapsobservasjoner,
              arrangementer, preferansesignaler og invitasjoner beholdes som signaler.
            </div>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to="/nettverk/kontakter/import">Åpne importgjennomgang</Link>
            </Button>
          </div>
        )}
      </NetworkPanel>
    </div>
  );
}
