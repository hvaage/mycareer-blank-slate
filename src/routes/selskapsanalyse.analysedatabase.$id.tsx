import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { DimensionsRadar } from "@/components/selskapsanalyse/DimensionsRadar";
import { ScoreBadge } from "@/components/selskapsanalyse/ScoreBadge";
import { getReport, type DimensionEntry, type ReportRow } from "@/lib/reports.functions";

export const Route = createFileRoute("/selskapsanalyse/analysedatabase/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Selskapsrapport — Analysedatabase` },
      { name: "robots", content: "index, follow" },
      {
        property: "og:url",
        content: `https://karrierenmin.no/selskapsanalyse/analysedatabase/${params.id}`,
      },
    ],
  }),
  component: ReportDetailPage,
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-serif">Rapport ikke funnet</h1>
        <p className="mt-2 text-muted-foreground">
          Den rapporten finnes ikke i Analysedatabasen.
        </p>
        <Link
          to="/selskapsanalyse/analysedatabase"
          className="mt-6 inline-block text-primary"
        >
          Tilbake til Analysedatabasen
        </Link>
      </main>
      <Footer />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-serif">Noe gikk galt</h1>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
      </main>
      <Footer />
    </div>
  ),
});

const LABEL_NB: Record<string, string> = {
  sourced: "Sourced",
  partial: "Delvis",
  insufficient_data: "Ikke nok data",
  not_assessed: "Ikke vurdert",
};

function ReportDetailPage() {
  const { id } = Route.useParams();
  const fetchReport = useServerFn(getReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["report", id],
    queryFn: () => fetchReport({ data: { id } }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 mx-auto max-w-5xl px-6 py-12">
          <div className="h-48 rounded-xl border border-border bg-muted/40 animate-pulse" />
        </main>
        <Footer />
      </div>
    );
  }
  if (error) throw error;
  if (!data?.report) throw notFound();

  const r = data.report;
  const history = data.history;
  const dims = r.dimensions ?? [];
  const radarDims = dims.map((d: DimensionEntry) => ({
    label: d.name,
    score: d.score,
  }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 pb-4">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/selskapsanalyse" className="hover:text-foreground">
              Arbeidsgiveranalysen
            </Link>{" "}
            <span className="mx-1">›</span>{" "}
            <Link
              to="/selskapsanalyse/analysedatabase"
              className="hover:text-foreground"
            >
              Analysedatabase
            </Link>{" "}
            <span className="mx-1">›</span>{" "}
            <span className="text-foreground">{r.company_name}</span>
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-serif tracking-tight">
                {r.company_name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                <a
                  href={`https://${r.company_domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {r.company_domain}
                </a>
                {r.branch_country ? ` · ${r.branch_country}` : ""}
                {r.parent_country && r.parent_country !== r.branch_country
                  ? ` (morselskap: ${r.parent_country})`
                  : ""}
              </p>
            </div>
            <ScoreBadge score={r.overall_score} size="lg" />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {r.analysis_date && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                Analysedato: {r.analysis_date}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 uppercase">
              {r.tier}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 uppercase">
              {r.language}
            </span>
            {r.employee_count != null && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                ~ {r.employee_count.toLocaleString("nb-NO")} ansatte
                {r.employee_count_source ? ` (${r.employee_count_source})` : ""}
              </span>
            )}
            {r.revenue_bucket && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                Omsetning: {r.revenue_bucket}
              </span>
            )}
            {r.industry_nace && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                NACE {r.industry_nace}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5">
              {r.source_count ?? 0} kilder · {r.search_count ?? 0} søk
            </span>
            {r.scope_deviation && (
              <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5">
                Utenfor offisielt scope
              </span>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 sm:px-6 py-6 grid lg:grid-cols-[1fr_1fr] gap-8 items-start">
          <div className="rounded-xl border border-border bg-card p-6 text-primary">
            <DimensionsRadar
              dimensions={radarDims}
              ariaLabel={`Radardiagram for ${r.company_name}`}
            />
          </div>
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3 text-sm font-medium">
              Dimensjoner ({r.scored_dimensions ?? 0}/{r.total_dimensions ?? 8} scoret)
            </div>
            <ul className="divide-y divide-border">
              {dims.map((d: DimensionEntry, i: number) => (
                <li
                  key={`${d.name}-${i}`}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {LABEL_NB[d.label] ?? d.label}
                      {d.source_count != null
                        ? ` · ${d.source_count} kilder`
                        : ""}
                    </p>
                  </div>
                  <ScoreBadge score={d.score} size="sm" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {history.length > 1 && (
          <section className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
            <h2 className="text-xl font-serif mb-3">Historikk</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {history.length} rapporter for {r.company_name}. Hver innsending er
              bevart for å vise utvikling over tid.
            </p>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Dato</th>
                    <th className="px-4 py-2 text-left">Tier</th>
                    <th className="px-4 py-2 text-left">Språk</th>
                    <th className="px-4 py-2 text-right">Ansatte</th>
                    <th className="px-4 py-2 text-right">Dim.</th>
                    <th className="px-4 py-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h: ReportRow) => (
                    <tr
                      key={h.id}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-4 py-2">
                        {h.id === r.id ? (
                          <span className="font-medium">
                            {h.submitted_at.slice(0, 10)} (denne)
                          </span>
                        ) : (
                          <Link
                            to="/selskapsanalyse/analysedatabase/$id"
                            params={{ id: h.id }}
                            className="text-primary hover:underline"
                          >
                            {h.submitted_at.slice(0, 10)}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2 uppercase text-xs">{h.tier}</td>
                      <td className="px-4 py-2 uppercase text-xs">
                        {h.language}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {h.employee_count != null
                          ? h.employee_count.toLocaleString("nb-NO")
                          : "–"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {(h.scored_dimensions ?? 0)}/{h.total_dimensions ?? 8}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <ScoreBadge score={h.overall_score} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mx-auto max-w-5xl px-4 sm:px-6 py-10 text-center">
          <Link
            to="/selskapsanalyse"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Generer din egen rapport
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
