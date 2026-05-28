import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { PageHero } from "@/components/landing/PageHero";
import { ReportCard } from "@/components/selskapsanalyse/ReportCard";
import { listReports } from "@/lib/reports.functions";


export const Route = createFileRoute("/selskapsanalyse/analysedatabase/")({
  head: () => ({
    meta: [
      { title: "Analysedatabase — Karrierenmin" },
      {
        name: "description",
        content:
          "Åpen database over arbeidsgiver-analyser generert med Arbeidsgiveranalysen. Søk og sammenlign selskaper på åtte dimensjoner.",
      },
      { property: "og:title", content: "Analysedatabase — Karrierenmin" },
      {
        property: "og:description",
        content:
          "Felles, åpen database over arbeidsgiveranalyser. Finn selskapsscore på åtte dimensjoner og se utvikling over tid.",
      },
      {
        property: "og:url",
        content: "https://karrierenmin.no/selskapsanalyse/analysedatabase",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://karrierenmin.no/selskapsanalyse/analysedatabase",
      },
    ],
  }),
  component: AnalysedatabasePage,
});

function AnalysedatabasePage() {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [tier, setTier] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState<"recent" | "score" | "most_reports">(
    "recent"
  );
  const [page, setPage] = useState(1);

  const fetchList = useServerFn(listReports);
  const { data, isLoading } = useQuery({
    queryKey: ["reports-list", search, country, tier, language, sort, page],
    queryFn: () =>
      fetchList({
        data: { search, country, tier, language, sort, page, pageSize: 24 },
      }),
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--km-paper)]">
      <Header />
      <PageHero
        eyebrow="ANALYSEDATABASE"
        title={
          <>
            Åpen <span className="text-[var(--km-blue)]">analysedatabase</span> over arbeidsgivere
          </>
        }
        lead="Åpen, voksende kunnskapsbase over arbeidsgivere — bygget av brukere som kjører Arbeidsgiveranalysen. Søk på selskap, sammenlign score på de åtte dimensjonene, og følg utviklingen over tid."
        action={
          <Link
            to="/selskapsanalyse"
            className="inline-flex h-10 items-center rounded-md border border-rule bg-white px-4 text-sm font-medium text-[var(--km-ink)] hover:bg-[var(--km-paper-warm)] transition-colors"
          >
            ← Tilbake til Arbeidsgiveranalysen
          </Link>
        }
      />
      <main className="flex-1">


        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-6">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Søk på selskapsnavn eller domene…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex flex-wrap gap-2 text-sm">
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Alle land</option>
                {data?.facets.countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Alle nivå</option>
                {data?.facets.tiers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Alle språk</option>
                {data?.facets.languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value as typeof sort)
                }
                className="ml-auto rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="recent">Nyeste først</option>
                <option value="score">Høyest score</option>
                <option value="most_reports">Flest rapporter</option>
              </select>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16">
          {isLoading && !data && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-44 rounded-xl border border-border bg-muted/40 animate-pulse"
                />
              ))}
            </div>
          )}

          {data && data.groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <p className="text-muted-foreground">
                Ingen rapporter matcher søket ditt ennå. Prøv andre filtre, eller{" "}
                <Link
                  to="/selskapsanalyse"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  generer din egen rapport
                </Link>
                .
              </p>
            </div>
          )}

          {data && data.groups.length > 0 && (
            <>
              <p className="mb-4 text-xs text-muted-foreground">
                {data.total} selskap{data.total === 1 ? "" : "er"}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.groups.map((g) => (
                  <ReportCard
                    key={g.domain}
                    latest={g.latest}
                    reportCount={g.report_count}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    Forrige
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Side {page} / {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={page >= totalPages}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    Neste
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
