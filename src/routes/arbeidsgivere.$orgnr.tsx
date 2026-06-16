import { createFileRoute, useRouter, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { employerDetailQuery } from "@/lib/queries/employer-insight";
import { fylkesnavn } from "@/lib/employers/no-regions";
import { TypeBadge, RiskBadges, DataQualityBadges } from "@/components/employers/Badges";
import { OverviewPanel } from "@/components/employers/OverviewPanel";
import { RegisterPanel } from "@/components/employers/RegisterPanel";
import { EightDimensionsPanel } from "@/components/employers/EightDimensionsPanel";
import { AiMaturityPanel } from "@/components/employers/AiMaturityPanel";
import { SixDimensionAiPanel } from "@/components/employers/SixDimensionAiPanel";
import { EmployeeRatingsPanel } from "@/components/employers/EmployeeRatingsPanel";
import { JobseekerProcessPanel } from "@/components/employers/JobseekerProcessPanel";
import { SourcesPanel } from "@/components/employers/SourcesPanel";

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
        content: `Register-, regnskaps- og analyseinnsikt for organisasjonsnummer ${params.orgnr}.`,
      },
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

  return (
    <Shell>
      <div className="mb-4">
        <Link
          to="/arbeidsgivere"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Tilbake til arbeidsgiversøk
        </Link>
      </div>
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
        <div className="flex flex-col gap-1">
          <RiskBadges flags={d.risiko_flags} />
          <DataQualityBadges flags={d.datakvalitet_flags} />
        </div>
      </header>

      <Tabs defaultValue="oversikt" className="mt-6">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex">
            <TabsTrigger value="oversikt">Oversikt</TabsTrigger>
            <TabsTrigger value="register">Register og regnskap</TabsTrigger>
            <TabsTrigger value="dim8">8 dimensjoner</TabsTrigger>
            <TabsTrigger value="ai_maturity">AI-kompetanse</TabsTrigger>
            <TabsTrigger value="ai6">AI-vurdering (6 dim)</TabsTrigger>
            <TabsTrigger value="ansatte">Ansattes vurderinger</TabsTrigger>
            <TabsTrigger value="sokere">Søkeres vurderinger</TabsTrigger>
            <TabsTrigger value="kilder">Kilder og datakvalitet</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="oversikt" className="mt-4">
          <OverviewPanel d={d} />
        </TabsContent>
        <TabsContent value="register" className="mt-4">
          <RegisterPanel d={d} />
        </TabsContent>
        <TabsContent value="dim8" className="mt-4">
          <EightDimensionsPanel orgnr={d.organisasjonsnummer} />
        </TabsContent>
        <TabsContent value="ai_maturity" className="mt-4">
          <AiMaturityPanel orgnr={d.organisasjonsnummer} />
        </TabsContent>
        <TabsContent value="ai6" className="mt-4">
          <SixDimensionAiPanel d={d} />
        </TabsContent>
        <TabsContent value="ansatte" className="mt-4">
          <EmployeeRatingsPanel d={d} orgnr={d.organisasjonsnummer} />
        </TabsContent>
        <TabsContent value="sokere" className="mt-4">
          <JobseekerProcessPanel d={d} orgnr={d.organisasjonsnummer} />
        </TabsContent>
        <TabsContent value="kilder" className="mt-4">
          <SourcesPanel d={d} />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--km-paper)]">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">{children}</div>
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
