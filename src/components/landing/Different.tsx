import { Check } from "lucide-react";

const benefits = [
  "Se hva stillingen din faktisk bør lønne — for din alder og bransje, ikke et generelt gjennomsnitt.",
  "Sjekk arbeidsgiveren du vurderer eller har jobbet for — størrelse, vekst, og hva tidligere ansatte faktisk sier.",
  "Finn ut hvor det er reell mangel på folk i ditt fagfelt, i ditt område.",
  "Se nøyaktig hvilke kompetanser som mangler mellom deg og målrollen din.",
  "Dokumenter det du gjør mens det skjer — ikke bare når du plutselig må huske alt til en søknad.",
];

export function Different() {
  return (
    <section
      id="annerledes"
      className="border-y border-[var(--km-rule)] bg-[var(--km-paper-warm)]"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
            Hva du får
          </p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-[var(--km-ink)]">
            Ikke et engangsdokument
          </h2>
          <p className="mt-4 text-[16px] leading-[1.6] text-[var(--km-ink-soft)]">
            Et system som viser deg mer enn du visste du kunne finne ut — om deg
            selv, arbeidsgiverne du vurderer, og markedet du står i.
          </p>
        </div>

        <ul className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
          {benefits.map((item, i) => (
            <li
              key={item}
              className={
                "flex gap-3 rounded-[10px] border border-[var(--km-rule)] bg-white p-5 shadow-[0_8px_24px_rgba(26,31,43,0.06)]" +
                (i === benefits.length - 1 && benefits.length % 2 === 1
                  ? " sm:col-span-2"
                  : "")
              }
            >
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

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-[var(--km-ink-faint)]">
          Alt dette er klart å sjekke på under to minutter — gratis, og uten at
          noen arbeidsgiver får vite at du var innom.
        </p>
      </div>
    </section>
  );
}
