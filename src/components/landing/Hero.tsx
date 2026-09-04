import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-woman-denim.webp.asset.json";

const trustItems = ["Gratis å starte", "Ingen kredittkort", "2 minutter å komme i gang"];

const logEntries = [
  {
    dot: "var(--km-success)",
    title: "Ledet migrering til nytt CRM-system",
    meta: "Lagt til for 3 dager siden · Prosjektleder-rollen",
  },
  {
    dot: "var(--km-blue)",
    title: "Fullførte sertifisering i prosjektstyring",
    meta: "Lagt til for 2 uker siden · Kompetanse",
  },
  {
    dot: "var(--km-accent-sage)",
    title: "Redusert leveringstid med 18 %",
    meta: "Lagt til for 1 måned siden · Resultat",
  },
];

export function Hero() {
  return (
    <section id="top">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:py-24">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          {/* Venstre kolonne */}
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
              Karrieren min
            </p>
            <h1 className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--km-ink)] lg:text-[44px]">
              Du kan mer enn du tror.
              <br />
              Du husker mindre enn du burde.
            </h1>
            <p className="mt-3 font-mono text-xs font-medium uppercase tracking-[0.08em] text-[var(--km-ink-faint)]">
              Systemet som dokumenterer karrieren din
            </p>
            <p className="mt-5 max-w-[520px] text-[17px] leading-[1.6] text-[var(--km-ink-soft)]">
              Karrieren din skjer hver dag. Alt du har oppnådd, fortjener å bli
              husket og dokumentert — ikke bare gjenskapt i siste liten.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-[var(--km-blue)] text-white hover:bg-[var(--km-blue-deep)]"
              >
                <Link to="/signup">Kom i gang gratis</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/" hash="hva">Se hvordan det fungerer</Link>
              </Button>
            </div>
            <ul className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--km-ink-faint)]">
              {trustItems.map((item, i) => (
                <li key={item} className="flex items-center gap-2">
                  {i > 0 && (
                    <span
                      className="h-1 w-1 rounded-full bg-[var(--km-ink-faint)]"
                      aria-hidden
                    />
                  )}
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-6 max-w-[520px] space-y-2 rounded-[10px] border border-[var(--km-rule)] bg-white/70 p-5 text-[13px] leading-relaxed text-[var(--km-ink-soft)]">
              <p>
                <span className="font-semibold text-[var(--km-ink)]">Ingen interessekonflikt.</span>{" "}
                Vi er ikke et rekrutteringsbyrå og tjener ingenting på hvilken jobb du velger.
              </p>
              <p>
                <span className="font-semibold text-[var(--km-ink)]">Dine data er dine.</span>{" "}
                Se nøyaktig hva som er lagret om deg, og slett det når du vil.
              </p>
              <p>
                <span className="font-semibold text-[var(--km-ink)]">Gratis å starte.</span>{" "}
                Ingen kredittkort, ingen bindingstid.
              </p>
            </div>
          </div>

          {/* Høyre kolonne — bildet vises i sin helhet, aldri beskåret.
              Logg-boksen overlapper nedre høyre hjørne av bildet. */}
          <div className="relative pb-14 lg:pb-20">
            <img
              src={heroImage.url}
              alt="Kvinne i dongeriskjorte ved skrivebordet, ser ut av vinduet med et rolig smil"
              className="w-full rounded-xl shadow-[0_8px_24px_rgba(26,31,43,0.10)]"
              width={1536}
              height={1024}
              fetchPriority="high"
            />
            <div className="relative z-10 -mt-8 ml-auto w-[96%] rounded-xl border border-[var(--km-rule)] bg-white p-5 shadow-[0_16px_40px_rgba(26,31,43,0.14)] sm:-mt-14 sm:w-[88%] lg:-mt-20 lg:-mr-20">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--km-ink-faint)]">
                  Din karrierelogg
                </p>
                <span className="rounded-full bg-[var(--km-accent-warm-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--km-accent-warm)]">
                  Eksempel
                </span>
              </div>
              <ul className="mt-4 space-y-3.5">
                {logEntries.map((entry) => (
                  <li key={entry.title} className="flex gap-3">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: entry.dot }}
                      aria-hidden
                    />
                    <div>
                      <p className="text-[13px] font-semibold leading-snug text-[var(--km-ink)]">
                        {entry.title}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--km-ink-faint)]">
                        {entry.meta}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-[var(--km-rule-soft)] pt-3.5">
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--km-blue)]">
                  <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  Legg til det du gjorde i dag — tar 30 sekunder
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
