import { ShieldCheck, PenLine, Target, Archive } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { FeatureCard } from "./FeatureCard";

const items = [
  {
    icon: ShieldCheck,
    title: "Ikke generiske CV-er",
    description: "Tilpasset faktiske utvelgelsesprosesser i Norge.",
  },
  {
    icon: PenLine,
    title: "Bygget på din egen erfaring",
    description: "Innholdet tar utgangspunkt i det du faktisk har gjort, så det du sender ut blir personlig og gjenkjennelig.",
  },
  {
    icon: Target,
    title: "Du bygger en posisjon",
    description: "Fokus på å bli valgt, ikke sende flest søknader.",
  },
  {
    icon: Archive,
    title: "Alt kan dokumenteres",
    description: "Alt du gjør kan brukes videre.",
  },
];

export function Different() {
  return (
    <section id="annerledes" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading
          eyebrow="Hva som gjør dette annerledes"
          title="Bygget for norske karriereløp"
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
