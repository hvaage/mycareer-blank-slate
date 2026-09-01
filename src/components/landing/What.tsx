import { Activity, Compass, Target, Users } from "lucide-react";

const features = [
  {
    icon: Activity,
    title: "Dokumenter kontinuerlig",
    description:
      "Registrer det du oppnår og gjør fortløpende — ikke bare når du skal søke jobb neste gang.",
  },
  {
    icon: Compass,
    title: "Definer retning",
    description:
      "Sett mål for hvor du vil i karrieren, og la systemet vise deg veien dit.",
  },
  {
    icon: Target,
    title: "Match mot jobbannonser",
    description:
      "Få annonser vurdert opp mot dine faktiske kvalifikasjoner og ønsker — ikke bare søkeord.",
  },
  {
    icon: Users,
    title: "Bygg nettverk og profil",
    description:
      "Få hjelp med nettverksarbeid og profilering mot arbeidsgiverne du vil nå.",
  },
];

export function What() {
  return (
    <section id="hva">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
            Fire funksjoner, ett system
          </p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-[var(--km-ink)]">
            Et system for hele karrieren
          </h2>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-[10px] border border-[var(--km-rule)] bg-white p-6 shadow-[0_8px_24px_rgba(26,31,43,0.06)]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--km-blue-soft)]">
                <feature.icon
                  className="h-4.5 w-4.5 text-[var(--km-blue-deep)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-[var(--km-ink)]">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--km-ink-soft)]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
