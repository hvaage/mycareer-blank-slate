import { X, Check } from "lucide-react";

const expected = [
  "Et engangsdokument du fyller ut når du skal søke",
  "En statisk mal du må huske å oppdatere selv",
  "Noe du glemmer helt til neste jobbjakt starter",
];

const actual = [
  "Kontinuerlig dokumentasjon av det du oppnår og gjør",
  "Retning og mål for hvor du vil i karrieren",
  "Matching mot reelle jobbannonser, og hjelp med nettverk og synlighet",
];

export function Different() {
  return (
    <section
      id="annerledes"
      className="border-y border-[var(--km-rule)] bg-[var(--km-paper-warm)]"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
            Hva dette faktisk er
          </p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-[var(--km-ink)]">
            Ikke enda en CV-generator
          </h2>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[10px] border border-[var(--km-rule)] bg-white p-7 shadow-[0_8px_24px_rgba(26,31,43,0.06)]">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--km-ink-faint)]">
              Det du kanskje forventet
            </p>
            <ul className="mt-5 space-y-4">
              {expected.map((item) => (
                <li key={item} className="flex gap-3">
                  <X
                    className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--km-danger)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="text-sm leading-relaxed text-[var(--km-ink-soft)]">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[10px] border border-[var(--km-blue)] bg-white p-7 shadow-[0_8px_24px_rgba(26,31,43,0.06)]">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--km-blue)]">
              Det dette faktisk er
            </p>
            <ul className="mt-5 space-y-4">
              {actual.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check
                    className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--km-success)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="text-sm leading-relaxed text-[var(--km-ink-soft)]">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
