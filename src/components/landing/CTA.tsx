import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24 md:py-32">
        <h2 className="text-2xl text-foreground sm:text-3xl md:text-5xl">
          Start å bygge din karriereplattform
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Få oversikt, dokumenter erfaring og ta strukturerte beslutninger gjennom hele karrieren.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link to="/signup">Kom i gang</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link to="/" hash="hvordan">Se hvordan det fungerer</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

