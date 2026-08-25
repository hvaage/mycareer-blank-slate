// @ts-nocheck
import { Mail } from "lucide-react";
import { ComingSoonStub } from "@/components/coming-soon-stub";

export function EmailConnections() {
  return (
    <ComingSoonStub
      icon={Mail}
      title="Gmail-tilkobling kommer snart"
      description="Vi jobber med å hente jobbvarsler fra Gmail rett inn i appen."
      features={[
        "Les jobbvarsler fra Gmail og Outlook automatisk",
        "Stillinger dukker opp som leads uten manuelt arbeid",
        "Videresending av annonse-e-poster med egen adresse",
      ]}
    />
  );
}
