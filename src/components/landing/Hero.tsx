import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section id="top" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-3xl">
          <p className="mb-6 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Karriereplattform
          </p>
          <h1 className="text-4xl leading-[1.1] text-foreground sm:text-5xl md:text-6xl">
            Ta kontroll over karrieren din – fra første jobb til styreverv
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Samle erfaring, forstå markedet, dokumenter valg og ta bedre beslutninger gjennom hele
            karrieren.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href="#hvordan">Forstå hvordan det fungerer</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#annerledes">Se hva som gjør dette annerledes</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
