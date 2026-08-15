import { createFileRoute, useRouter, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  employerDetailQuery,
  employerFormaalQuery,
  employerRegnskapHistoryQuery,
} from "@/lib/queries/employer-insight";
import { employerAnalysisViewQuery } from "@/lib/queries/employer-analysis-view";
import { useAuth } from "@/lib/auth-context";
import { fylkesnavn } from "@/lib/employers/no-regions";
import { TypeBadge, DataQualityBadges } from "@/components/employers/Badges";
import { NokkeltallPanel } from "@/components/employers/NokkeltallPanel";
import { OkonomiPanel } from "@/components/employers/OkonomiPanel";
import { RegnskapHistorikk } from "@/components/employers/RegnskapHistorikk";
import { RegisterPanel } from "@/components/employers/RegisterPanel";
import { EmployeeRatingsPanel } from "@/components/employers/EmployeeRatingsPanel";
import { JobseekerProcessPanel } from "@/components/employers/JobseekerProcessPanel";
import { EmployerAnalysisReportV2 } from "@/components/employers/EmployerAnalysisReportV2";

export const Route = createFileRoute("/arbeidsgivere/$orgnr")({
  loader: async ({ params, context }) => {
    const res = await context.queryClient.ensureQueryData(employerDetailQuery(params.orgnr));
    if (res.kind === "not_found") throw notFound();
    return null;
  },
  head: ({ params }) => ({
    meta: [
      { title: `Arbeidsgiver ${params.orgnr} — Karrierenmin` },
      {
        name: "description",
        content: `Ansatte, økonomi og registerdata for organisasjonsnummer ${params.orgnr}, samlet på én side.`,
      },
      { property: "og:title", content: `Arbeidsgiver ${params.orgnr} — Karrierenmin` },
      {
        property: "og:description",
        content: `Ansatte, økonomi og registerdata for organisasjonsnummer ${params.orgnr}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "canonical",
        href: `https://karrierenmin.no/arbeidsgivere/${params.orgnr}`,
      },
    ],
  }),
  component: DetailPage,
  errorComponent: DetailError,
  notFoundComponent: NotFoundView,
});

function DetailPage() {
  const { orgnr } = Route.useParams();
  const { data: res } = useSuspenseQuery(employerDetailQuery(orgnr));
  const { user } = useAuth();
  const userKey = user?.id ?? "anon";
  const { data: formaal } = useQuery(employerFormaalQuery(orgnr));
  const { data: regnskapsaar } = useQuery(employerRegnskapHistoryQuery(orgnr));
  const {
    data: envelope,
    isPending: envelopePending,
    isError: envelopeError,
    error: envelopeErrorObj,
    refetch: envelopeRefetch,
  } = useQuery(employerAnalysisViewQuery(orgnr, userKey));

  if (res.kind === "unavailable") {
    return (
      <Shell>
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium text-foreground">
            Arbeidsgiver-viewet er ikke konfigurert ennå
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            employer_search_v1 er ikke tilgjengelig. Backend-kontrakten må på plass først.
          </p>
        </div>
      </Shell>
    );
  }

  if (res.kind === "not_found") {
    return <NotFoundView />;
  }

  const d = res.data;
  const sted = [
    d.forretningsadresse_kommune,
    d.forretningsadresse_fylke ?? fylkesnavn(d.forretningsadresse_fylkesnummer),
  ]
    .filter(Boolean)
    .join(", ");
  const bransje = d.naeringskode1_beskrivelse ?? d.naeringskode1_kode ?? null;
  const harAnalyse = Boolean(envelope?.analysis);

  return (
    <Shell>
      <div className="mb-4">
        <Link
          to="/arbeidsgivere"
          search={{
            q: "",
            kommuneQuery: "",
            bransjeQuery: "",
            fylke: "",
            kommune: "",
            nace: "",
            type: "",
            page: 1,
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Tilbake til arbeidsgiversøk
        </Link>
      </div>

      {/* 1. Overskrift */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{d.navn}</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            Orgnr {d.organisasjonsnummer}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {sted && <span>{sted}</span>}
          {bransje && (
            <>
              <span aria-hidden>·</span>
              <span>{bransje}</span>
            </>
          )}
          <TypeBadge value={d.arbeidsgiver_type} />
          {d.regnskapsaar !== null && d.regnskapsaar !== undefined && (
            <Badge variant="outline" className="font-normal">
              Regnskap {d.regnskapsaar}
            </Badge>
          )}
        </div>
        <DataQualityBadges flags={d.datakvalitet_flags} />
      </header>

      {/* 2. Nøkkeltall */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-display font-semibold tracking-tight text-foreground">
          Nøkkeltall om arbeidsgiveren
        </h2>
        <NokkeltallPanel d={d} />
        {formaal && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Vedtektsfestet formål: </span>
            {formaal}
          </p>
        )}
      </section>

      {/* 3. Økonomisk bilde */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-display font-semibold tracking-tight text-foreground">
          Økonomisk bilde
        </h2>
        <OkonomiPanel d={d} />
      </section>

      {/* 3b. Utvikling over tid — skjuler seg selv med færre enn to år */}
      <RegnskapHistorikk rader={regnskapsaar} />

      {/* 4. Registerdetaljer, kollapset */}
      <section className="mt-10">
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left">
            <span className="text-sm font-semibold text-foreground">
              Registerdetaljer fra Enhetsregisteret
            </span>
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-b-lg border-x border-b border-border bg-card px-4 py-4">
            <RegisterPanel d={d} />
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* 5. Vurderinger */}
      <section className="mt-10 space-y-8">
        <h2 className="text-lg font-display font-semibold tracking-tight text-foreground">
          Vurderinger
        </h2>

        {envelopeError ? (
          <p className="text-sm text-muted-foreground">
            Arbeidsgiveranalysen kunne ikke hentes
            {envelopeErrorObj instanceof Error ? `: ${envelopeErrorObj.message}` : ""}.{" "}
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 align-baseline"
              onClick={() => envelopeRefetch()}
            >
              Prøv igjen
            </Button>
          </p>
        ) : envelopePending ? (
          <p className="text-sm text-muted-foreground">Henter arbeidsgiveranalyse…</p>
        ) : harAnalyse && envelope ? (
          <div>
            <EmployerAnalysisReportV2
              envelope={envelope}
              mode="public"
              showCompanyHeader={false}
            />
            {envelope.company?.analysis_rated_at ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Analyse oppdatert{" "}
                {new Date(envelope.company.analysis_rated_at).toLocaleDateString("nb-NO", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ingen KI-analyse av denne arbeidsgiveren ennå.
          </p>
        )}

        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Ansattes vurderinger</h3>
          <EmployeeRatingsPanel d={d} orgnr={d.organisasjonsnummer} />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Søkeres vurdering av jobbprosessen
          </h3>
          <JobseekerProcessPanel d={d} orgnr={d.organisasjonsnummer} />
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--km-paper)]">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

function DetailError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Shell>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-foreground">Kunne ikke hente arbeidsgiver</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Prøv igjen
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function NotFoundView() {
  const { orgnr } = Route.useParams();
  return (
    <Shell>
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm font-medium text-foreground">Fant ikke arbeidsgiver</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingen treff på organisasjonsnummer <span className="tabular-nums">{orgnr}</span>.
        </p>
      </div>
    </Shell>
  );
}
