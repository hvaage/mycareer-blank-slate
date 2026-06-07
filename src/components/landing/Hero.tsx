import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section id="top" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24 md:py-32">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground sm:mb-6 sm:text-sm">
            Karriereplattform
          </p>
          <h1 className="text-[2rem] leading-[1.1] text-foreground sm:text-5xl md:text-6xl">
            Ta kontroll over karrieren din – fra første jobb til styreverv
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
            Samle erfaring, forstå markedet, dokumenter valg og ta bedre beslutninger gjennom hele
            karrieren.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/signup">Kom i gang</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link to="/" hash="hvordan">Forstå hvordan det fungerer</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
