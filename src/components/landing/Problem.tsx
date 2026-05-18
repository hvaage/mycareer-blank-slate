import { Shuffle, LayoutGrid, FileX, AlertCircle } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { FeatureCard } from "./FeatureCard";

const items = [
  {
    icon: Shuffle,
    title: "Fragmentert informasjon",
    description: "Jobber og dialoger er spredt på e-post, LinkedIn og Finn.",
  },
  {
    icon: LayoutGrid,
    title: "Manglende struktur",
    description: "Vanskelig å holde oversikt over hva du har gjort.",
  },
  {
    icon: FileX,
    title: "Lite dokumentasjon",
    description: "Erfaring og vurderinger blir ikke systematisert.",
  },
  {
    icon: AlertCircle,
    title: "Svakt beslutningsgrunnlag",
    description: "Valg tas uten god forståelse for markedet.",
  },
];

export function Problem() {
  return (
    <section className="border-b border-border bg-muted/50">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading
          eyebrow="Problemet"
          title="Karrierearbeid skjer i dag uten struktur"
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
