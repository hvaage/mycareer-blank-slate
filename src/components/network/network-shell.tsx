// @ts-nocheck
import { useMemo, useState, type ReactNode } from "react";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthUserId } from "@/components/network/use-network-user";
import { networkGraphQuery, searchNetwork } from "@/lib/queries/network";

const TABS = [
  { label: "Oversikt", to: "/nettverk/oversikt" },
  { label: "Selskaper", to: "/nettverk/selskaper" },
  { label: "Kontakter", to: "/nettverk/kontakter" },
  { label: "Muligheter", to: "/nettverk/muligheter" },
  { label: "Aktiviteter", to: "/nettverk/aktiviteter" },
] as const;

export function NetworkShell({ children }: { children: ReactNode }) {
  const userId = useAuthUserId();
  const [term, setTerm] = useState("");
  const { data: graph } = useQuery(networkGraphQuery(userId));
  const results = useMemo(
    () => (graph ? searchNetwork(graph, term) : { contacts: [], companies: [], opportunities: [] }),
    [graph, term],
  );
  const hasResults =
    results.contacts.length + results.companies.length + results.opportunities.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:h-[calc(100vh-4rem)] md:overflow-hidden">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Nettverksarbeid</h1>
          <p className="text-sm text-muted-foreground">
            Selskaper, kontakter, muligheter og aktiviteter i ditt eget arbeidsrom.
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Søk i kontakter, selskaper og muligheter"
            className="pl-8"
            aria-label="Søk i nettverksarbeid"
          />
          {term.trim().length >= 2 ? (
            <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
              {!hasResults ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">Ingen treff.</p>
              ) : null}
              <SearchGroup label="Kontakter">
                {results.contacts.map((c) => (
                  <SearchLink
                    key={c.id}
                    to="/nettverk/kontakter/$id"
                    params={{ id: c.id }}
                    onNavigate={() => setTerm("")}
                    primary={c.display_name}
                    secondary={c.company}
                  />
                ))}
              </SearchGroup>
              <SearchGroup label="Selskaper">
                {results.companies.map((c) => (
                  <SearchLink
                    key={c.key}
                    to="/nettverk/selskaper/$id"
                    params={{ id: c.key }}
                    onNavigate={() => setTerm("")}
                    primary={c.name}
                    secondary={`${c.contactCount} kontakt(er)`}
                  />
                ))}
              </SearchGroup>
              <SearchGroup label="Muligheter">
                {results.opportunities.map((o) => (
                  <SearchLink
                    key={o.id}
                    to="/nettverk/muligheter/$id"
                    params={{ id: o.id }}
                    onNavigate={() => setTerm("")}
                    primary={o.title}
                    secondary={o.company}
                  />
                ))}
              </SearchGroup>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Nettverksarbeid">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:font-medium [&.active]:text-foreground"
            activeOptions={{ exact: false }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col md:overflow-hidden">{children}</div>
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (!items || (Array.isArray(items) && items.length === 0)) return null;
  return (
    <div className="mb-1">
      <p className="px-2 pb-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {items}
    </div>
  );
}

function SearchLink({ to, params, primary, secondary, onNavigate }: any) {
  return (
    <Link
      to={to}
      params={params}
      onClick={onNavigate}
      className="block rounded px-2 py-1 text-sm hover:bg-accent"
    >
      <span className="font-medium">{primary}</span>
      {secondary ? <span className="text-muted-foreground"> · {secondary}</span> : null}
    </Link>
  );
}

/** Tilbake bruker faktisk navigasjonshistorikk og bevarer filtre/scroll. */
export function BackLink({ fallbackTo }: { fallbackTo: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 gap-1 px-2"
      onClick={() => {
        if (canGoBack) router.history.back();
        else router.navigate({ to: fallbackTo });
      }}
    >
      <ArrowLeft className="h-4 w-4" />
      Tilbake
    </Button>
  );
}
