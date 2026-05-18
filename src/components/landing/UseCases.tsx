import { GraduationCap, Briefcase, Users, Landmark } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { FeatureCard } from "./FeatureCard";

const items = [
  {
    icon: GraduationCap,
    title: "Nyutdannet",
    description: "Forstå hva du bør prioritere.",
  },
  {
    icon: Briefcase,
    title: "Erfaren",
    description: "Finn neste steg og bygg posisjon.",
  },
  {
    icon: Users,
    title: "Leder",
    description: "Evaluer roller og utvikling.",
  },
  {
    icon: Landmark,
    title: "Senior / styreverv",
    description: "Kartlegg relevante muligheter.",
  },
];

export function UseCases() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading eyebrow="Brukstilfeller" title="For ulike faser i karrieren" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
