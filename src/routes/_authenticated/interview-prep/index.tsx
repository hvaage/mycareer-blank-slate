// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { ComingSoonStub } from "@/components/coming-soon-stub";

export const Route = createFileRoute("/_authenticated/interview-prep/")({
  component: () => (
    <ComingSoonStub
      icon={MessageSquare}
      title="Intervjuforberedelse"
      description={`Forbered deg til intervjuet med AI-genererte spørsmål tilpasset stillingen, råd om hva du bør vite om selskapet, og øvingsdialoger.`}
      features={[
        "Vanlige intervjuspørsmål per bransje og rolle",
        "Selskapsspesifikke forberedelser basert på dine søknader",
        "STAR-metoden for strukturerte svar",
        "Lønnsnivå og forhandlingstips",
      ]}
    />
  ),
});
