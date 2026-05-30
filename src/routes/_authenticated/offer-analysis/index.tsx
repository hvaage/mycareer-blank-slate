import { createFileRoute } from "@tanstack/react-router";
import { BarChart2 } from "lucide-react";
import { ComingSoonStub } from "@/components/coming-soon-stub";

export const Route = createFileRoute("/_authenticated/offer-analysis/")({
  component: () => (
    <ComingSoonStub
      icon={BarChart2}
      title="Tilbudsvurdering"
      description={`Last opp et jobbtilbud og få en strukturert analyse av betingelsene — lønn, pensjon, ferie, fleksibilitet og andre faktorer.`}
      features={[
        "Sammenligning mot markedslønn for tilsvarende roller",
        "Vurdering av ikke-monetære goder",
        "Forhandlingsforslag basert på analysen",
        "Historikk over tilbud du har mottatt",
      ]}
    />
  ),
});
