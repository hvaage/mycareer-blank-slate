import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import dashboardImage from "@/assets/min-karriere-dashboard-fiktiv.png.asset.json";

export function Inside() {
  return (
    <section id="slik-ser-det-ut" className="border-t border-[var(--km-rule)]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
            Slik ser det ut innlogget
          </p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-[var(--km-ink)]">
            Ditt eget karrieredashboard
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-[1.6] text-[var(--km-ink-soft)]">
            Karrieregrunnlag, kompetanser, lønnsinnsikt og dokumentasjon — alt
            samlet på ett sted, klart neste gang du trenger det.
          </p>
        </div>
        <div className="relative mx-auto mt-10 max-w-5xl">
          <img
            src={dashboardImage.url}
            alt="Eksempel på karrieredashboardet til en innlogget bruker, med profil, kompetanser og lønnsinnsikt"
            className="w-full rounded-xl border border-[var(--km-rule)] shadow-[0_24px_60px_rgba(26,31,43,0.14)]"
            loading="lazy"
          />
          <span className="absolute right-3 top-3 rounded-full bg-[var(--km-accent-warm-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--km-accent-warm)]">
            Eksempel
          </span>
        </div>
        <div className="mt-8 text-center">
          <Button
            asChild
            size="lg"
            className="bg-[var(--km-blue)] text-white hover:bg-[var(--km-blue-deep)]"
          >
            <Link to="/signup">Få ditt eget dashboard</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
