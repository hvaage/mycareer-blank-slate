import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center md:py-32">
        <h2 className="text-3xl text-foreground md:text-5xl">
          Start å bygge din karriereplattform
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
          Få oversikt, dokumenter erfaring og ta strukturerte beslutninger gjennom hele karrieren.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/signup">Kom i gang</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#hvordan">Se hvordan det fungerer</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

