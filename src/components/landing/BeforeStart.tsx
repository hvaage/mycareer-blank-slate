import { Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const points = [
  "Gjør ingenting automatisk uten at du vurderer det",
  "Bygger på dine valg og din dokumentasjon",
  "Er laget for langsiktig bruk",
];

export function BeforeStart() {
  return (
    <section className="border-b border-border bg-muted/50">
      <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
        <div className="text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Før du starter
          </p>
          <h2 className="text-3xl text-foreground md:text-4xl">
            Et system du bygger over tid – på dine premisser
          </h2>
        </div>
        <ul className="mx-auto mt-10 max-w-xl space-y-3">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
              <span className="text-sm text-foreground">{point}</span>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <a href="#kom-i-gang">Forstå hvordan du kommer i gang</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
