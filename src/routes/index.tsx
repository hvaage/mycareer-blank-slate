import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { What } from "@/components/landing/What";
import { Different } from "@/components/landing/Different";
import { Problem } from "@/components/landing/Problem";
import { How } from "@/components/landing/How";
import { UseCases } from "@/components/landing/UseCases";
import { BeforeStart } from "@/components/landing/BeforeStart";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Karrierenmin — Ta kontroll over karrieren din" },
      {
        name: "description",
        content:
          "Et system for å forstå, dokumentere og styre egen karriere over tid – fra første jobb til styreverv.",
      },
      { property: "og:title", content: "Karrierenmin — Ta kontroll over karrieren din" },
      {
        property: "og:description",
        content:
          "Samle erfaring, forstå markedet, dokumenter valg og ta bedre beslutninger gjennom hele karrieren.",
      },
      { property: "og:url", content: "https://mycareer-blank-slate.lovable.app/" },
    ],
    links: [
      { rel: "canonical", href: "https://mycareer-blank-slate.lovable.app/" },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <What />
        <Different />
        <Problem />
        <How />
        <UseCases />
        <BeforeStart />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
