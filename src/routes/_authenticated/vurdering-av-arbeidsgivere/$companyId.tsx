/**
 * Vurdering av én arbeidsgiver — innlegging og visning i samme område.
 *
 * Brukeren blir værende i «Vurdering av arbeidsgivere» og sendes ikke over til
 * arbeidsgiveranalysene. Analysesiden er kun visning, og lenkes til eksplisitt.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { companyDetailQuery } from "@/lib/queries/companies";
import { EmployerCommonReview } from "@/components/employers/EmployerCommonReview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/vurdering-av-arbeidsgivere/$companyId")({
  component: RouteComponent,
  head: () => ({
    meta: [
      { title: "Vurder arbeidsgiver | Karrierenmin" },
      {
        name: "description",
        content:
          "Del erfaringene dine med en norsk arbeidsgiver og se felles, anonymiserte vurderinger fra andre.",
      },
      { property: "og:title", content: "Vurder arbeidsgiver" },
      {
        property: "og:description",
        content: "Gi din vurdering og se felles vurderinger fra andre med samme erfaringsgrunnlag.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function RouteComponent() {
  const { companyId } = Route.useParams();
  const { data, isLoading } = useQuery(companyDetailQuery(companyId));
  const company = data?.company as { name?: string | null; organisasjonsnummer?: string | null } | undefined;
  const orgnr = company?.organisasjonsnummer ?? null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Link to="/vurdering-av-arbeidsgivere">
        <Button variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Tilbake til vurdering av arbeidsgivere
        </Button>
      </Link>

      <header className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <h1 className="text-2xl font-display font-bold tracking-tight">
            {company?.name ?? "Arbeidsgiver"}
          </h1>
        )}
        {orgnr ? (
          <p className="text-sm text-muted-foreground">
            Organisasjonsnummer <span className="tabular-nums">{orgnr}</span>
          </p>
        ) : null}
      </header>

      <EmployerCommonReview
        companyId={companyId}
        orgnr={orgnr}
        companyName={company?.name ?? null}
      />

      <div>
        <Link to="/employers/$companyId" params={{ companyId }}>
          <Button variant="outline" size="sm">
            <BarChart3 className="h-4 w-4" /> Se arbeidsgiveranalyse
          </Button>
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          Arbeidsgiveranalysen er et eget område kun for visning av resultater.
        </p>
      </div>
    </div>
  );
}
