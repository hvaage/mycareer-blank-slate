import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 lg:py-24">
        <h2 className="text-[30px] font-semibold leading-[1.25] text-[var(--km-ink)]">
          Klar til å begynne å dokumentere?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-[var(--km-ink-soft)]">
          Kom i gang på under to minutter. Gratis å starte.
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="h-11 bg-[var(--km-blue)] px-8 text-white hover:bg-[var(--km-blue-deep)]"
          >
            <Link to="/signup">Kom i gang gratis</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
