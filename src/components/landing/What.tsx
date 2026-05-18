import { FileText, BarChart3, ClipboardCheck, Compass } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { FeatureCard } from "./FeatureCard";

const items = [
  {
    icon: FileText,
    title: "Karriereprofil",
    description: "Samle erfaring, resultater og kompetanse i én strukturert profil.",
  },
  {
    icon: BarChart3,
    title: "Markedsinnsikt",
    description: "Forstå arbeidsmarkedet basert på NAV, SSB og analyser av stillinger.",
  },
  {
    icon: ClipboardCheck,
    title: "Dokumentasjon",
    description: "Valg og vurderinger lagres og kan etterprøves.",
  },
  {
    icon: Compass,
    title: "Beslutningsstøtte",
    description: "Ta beslutninger basert på strukturert informasjon.",
  },
];

export function What() {
  return (
    <section id="hva" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading eyebrow="Hva dette er" title="Et system for hele karrieren" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
