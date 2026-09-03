import { createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/landing/Header";
import { AnnouncementBar } from "@/components/landing/AnnouncementBar";
import { Hero } from "@/components/landing/Hero";
import { Different } from "@/components/landing/Different";
import { What } from "@/components/landing/What";
import { Inside } from "@/components/landing/Inside";
import { Teaser } from "@/components/landing/Teaser";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Karrierenmin — Systemet som dokumenterer karrieren din" },
      {
        name: "description",
        content:
          "Ikke bare et CV-verktøy. KarrierenMin dokumenterer erfaringene og resultatene dine kontinuerlig, og matcher deg mot jobber som faktisk passer.",
      },
      {
        property: "og:title",
        content: "Karrierenmin — Systemet som dokumenterer karrieren din",
      },
      {
        property: "og:description",
        content:
          "Dokumenter karrieren din fortløpende, definer retning, match mot reelle jobbannonser og bygg nettverk — samlet i ett system.",
      },
      { property: "og:url", content: "https://karrierenmin.no/" },
    ],
    links: [{ rel: "canonical", href: "https://karrierenmin.no/" }],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <AnnouncementBar />
      <Header />
      <main>
        <Hero />
        <Different />
        <What />
        <Inside />
        <Teaser />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
