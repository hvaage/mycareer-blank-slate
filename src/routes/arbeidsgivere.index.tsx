import { useMemo } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/employers/SearchBar";
import { FilterPanel } from "@/components/employers/FilterPanel";
import { SelectionInsights } from "@/components/employers/SelectionInsights";
import { ResultsTable } from "@/components/employers/ResultsTable";
import {
  searchEmployersQuery,
  hasNextPage,
  type EmployerSearchFilters,
} from "@/lib/queries/employer-insight";

const PAGE_SIZE = 25;

type SearchState = {
  q: string;
  kommuneQuery: string;
  bransjeQuery: string;
  fylke: string;
  kommune: string;
  nace: string;
  ansatteMin?: number;
  ansatteMaks?: number;
  omsMin?: number;
  omsMaks?: number;
  type: string;
  page: number;
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export const Route = createFileRoute("/arbeidsgivere/")({
  validateSearch: (raw: Record<string, unknown>): SearchState => ({
    q: asStr(raw.q),
    kommuneQuery: asStr(raw.kommuneQuery),
    bransjeQuery: asStr(raw.bransjeQuery),
    fylke: asStr(raw.fylke),
    kommune: asStr(raw.kommune),
    nace: asStr(raw.nace),
    ansatteMin: asNum(raw.ansatteMin),
    ansatteMaks: asNum(raw.ansatteMaks),
    omsMin: asNum(raw.omsMin),
    omsMaks: asNum(raw.omsMaks),
    type: asStr(raw.type),
    page: Math.max(1, asNum(raw.page) ?? 1),
  }),
  head: () => ({
    meta: [
      { title: "Arbeidsgiverinnsikt — Karrierenmin" },
      {
        name: "description",
        content:
          "Søk i norske arbeidsgivere, filtrer på bransje, sted, ansatte og omsetning, og se register- og regnskapsdata samlet ett sted.",
      },
      { property: "og:title", content: "Arbeidsgiverinnsikt — Karrierenmin" },
      {
        property: "og:description",
        content:
          "Søke- og innsiktsverktøy for arbeidsgivere basert på offentlige data og analyser.",
      },
      { property: "og:url", content: "https://karrierenmin.no/arbeidsgivere" },
    ],
    links: [{ rel: "canonical", href: "https://karrierenmin.no/arbeidsgivere" }],
  }),
  component: ArbeidsgivereIndex,
});

function ArbeidsgivereIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/arbeidsgivere/" });

  const filters: EmployerSearchFilters = useMemo(
    () => ({
      q: search.q || undefined,
      kommuneQuery: search.kommuneQuery || undefined,
      bransjeQuery: search.bransjeQuery || undefined,
      fylke: search.fylke || undefined,
      kommune: search.kommune || undefined,
      nace: search.nace || undefined,
      ansatteMin: search.ansatteMin,
      ansatteMaks: search.ansatteMaks,
      omsMin: search.omsMin,
      omsMaks: search.omsMaks,
      type: search.type || undefined,
      page: search.page,
      pageSize: PAGE_SIZE,
    }),
    [search],
  );

  const { data, isFetching } = useQuery(searchEmployersQuery(filters));

  const update = (patch: Partial<SearchState>) => {
    navigate({
      search: ((prev: SearchState) => ({ ...prev, ...patch, page: 1 })) as never,
    });
  };
  const goPage = (n: number) => {
    navigate({
      search: ((prev: SearchState) => ({ ...prev, page: n })) as never,
    });
  };
  const reset = () => {
    navigate({
      search: {
        q: "",
        kommuneQuery: "",
        bransjeQuery: "",
        fylke: "",
        kommune: "",
        nace: "",
        type: "",
        page: 1,
      } as never,
    });
  };

  const hasAnyFilter = Boolean(
    search.kommuneQuery ||
      search.bransjeQuery ||
      search.fylke ||
      search.kommune ||
      search.nace ||
      search.type ||
      typeof search.ansatteMin === "number" ||
      typeof search.ansatteMaks === "number" ||
      typeof search.omsMin === "number" ||
      typeof search.omsMaks === "number" ||
      search.q,
  );

  const rows = data?.rows ?? [];
  const next = hasNextPage(rows, PAGE_SIZE, data?.totalCount ?? null, search.page);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--km-paper)]">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Tilbake til forsiden
            </Link>
          </div>

          <header>
            <h1 className="text-xl font-semibold text-foreground">Arbeidsgiverinnsikt</h1>
            <p className="text-sm text-muted-foreground">
              Søk i norske arbeidsgivere. Filtrer på bransje, sted, ansatte, omsetning og type.
            </p>
          </header>

          <div className="space-y-4">
            <SearchBar value={search.q} onChange={(v) => update({ q: v })} />
            <div className="rounded-lg border border-border bg-card p-4">
              <FilterPanel
                values={{
                  kommuneQuery: search.kommuneQuery || undefined,
                  bransjeQuery: search.bransjeQuery || undefined,
                  fylke: search.fylke || undefined,
                  kommune: search.kommune || undefined,
                  nace: search.nace || undefined,
                  ansatteMin: search.ansatteMin,
                  ansatteMaks: search.ansatteMaks,
                  omsMin: search.omsMin,
                  omsMaks: search.omsMaks,
                  type: search.type || undefined,
                }}
                onChange={(patch) => {
                  // Kumulativ innsnevring: bare endrede felter sendes,
                  // andre filtre bevares via { ...prev, ...patch } i update().
                  const normalized: Partial<SearchState> = {};
                  if ("kommuneQuery" in patch) normalized.kommuneQuery = patch.kommuneQuery ?? "";
                  if ("bransjeQuery" in patch) normalized.bransjeQuery = patch.bransjeQuery ?? "";
                  if ("fylke" in patch) normalized.fylke = patch.fylke ?? "";
                  if ("kommune" in patch) normalized.kommune = patch.kommune ?? "";
                  if ("nace" in patch) normalized.nace = patch.nace ?? "";
                  if ("type" in patch) normalized.type = patch.type ?? "";
                  if ("ansatteMin" in patch) normalized.ansatteMin = patch.ansatteMin;
                  if ("ansatteMaks" in patch) normalized.ansatteMaks = patch.ansatteMaks;
                  if ("omsMin" in patch) normalized.omsMin = patch.omsMin;
                  if ("omsMaks" in patch) normalized.omsMaks = patch.omsMaks;
                  update(normalized);
                }}
                onReset={reset}
              />
            </div>
          </div>

          <SelectionInsights
            rows={rows}
            page={search.page}
            pageSize={PAGE_SIZE}
            hasAnyFilter={hasAnyFilter}
          />

          <ResultsTable
            rows={rows}
            loading={isFetching}
            available={data?.available ?? true}
            errorMessage={data?.errorMessage ?? null}
          />

          {(rows.length > 0 || search.page > 1) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {typeof data?.totalCount === "number"
                  ? `${data.totalIsEstimate ? "Omtrent " : ""}${data.totalCount.toLocaleString("nb-NO")} treff`
                  : "Treffantall ikke tilgjengelig"}
              </span>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={search.page <= 1}
                  onClick={() => goPage(Math.max(1, search.page - 1))}
                >
                  Forrige
                </Button>
                <span className="text-xs text-muted-foreground">
                  Side <span className="tabular-nums">{search.page}</span>
                  {typeof data?.totalCount === "number"
                    ? ` av ${Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE))}`
                    : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!next}
                  onClick={() => goPage(search.page + 1)}
                >
                  Neste
                </Button>
              </div>
            </div>
          )}

        </div>
      </main>
      <Footer />
    </div>
  );
}
