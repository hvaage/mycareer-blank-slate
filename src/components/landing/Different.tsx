import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import colleaguesImage from "@/assets/colleagues-standing.webp.asset.json";

type Benefit = {
  text: string;
  to: "/arbeidsgivere" | "/markedsinnsikt" | "/signup";
  cta: string;
};

const benefits: Benefit[] = [
  {
    text: "Se hva stillingen din faktisk bør lønne — for din alder og bransje, ikke et generelt gjennomsnitt.",
    to: "/markedsinnsikt",
    cta: "Sjekk lønnsinnsikten",
  },
  {
    text: "Sjekk arbeidsgiveren du vurderer eller har jobbet for — størrelse, vekst, og hva tidligere ansatte faktisk sier.",
    to: "/arbeidsgivere",
    cta: "Sjekk arbeidsgiveranalysen",
  },
  {
    text: "Finn ut hvor det er reell mangel på folk i ditt fagfelt, i ditt område.",
    to: "/markedsinnsikt",
    cta: "Se underskudd i ditt område",
  },
  {
    text: "Se nøyaktig hvilke kompetanser som mangler mellom deg og målrollen din.",
    to: "/markedsinnsikt",
    cta: "Se kompetansegapet",
  },
  {
    text: "Dokumenter det du gjør mens det skjer — ikke bare når du plutselig må huske alt til en søknad.",
    to: "/signup",
    cta: "Start å dokumentere",
  },
];

export function Different() {
  return (
    <section
      id="annerledes"
      className="border-y border-[var(--km-rule)] bg-[var(--km-paper-warm)]"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[var(--km-blue)]">
              Hva du får
            </p>
            <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-[var(--km-ink)]">
              Karrierebygging over tid
            </h2>
            <p className="mt-4 max-w-[520px] text-[16px] leading-[1.6] text-[var(--km-ink-soft)]">
              Et system som viser deg mer enn du visste du kunne finne ut — om
              deg selv, arbeidsgiverne du vurderer, og markedet du står i.
            </p>
            <p className="mt-5 max-w-[520px] text-sm leading-relaxed text-[var(--km-ink-faint)]">
              Alt dette er klart å sjekke på under to minutter — gratis, og
              uten at noen arbeidsgiver får vite at du var innom.
            </p>
          </div>
          <img
            src={colleaguesImage.url}
            alt="To kolleger som ser sammen på en skjerm ved et ståbord"
            className="w-full rounded-[10px] shadow-[0_8px_24px_rgba(26,31,43,0.10)]"
            loading="lazy"
          />
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {benefits.map((item, i) => (
            <li
              key={item.text}
              className={
                i === benefits.length - 1 && benefits.length % 2 === 1
                  ? "sm:col-span-2"
                  : ""
              }
            >
              <Link
                to={item.to}
                className="group flex h-full flex-col justify-between gap-4 rounded-[10px] border border-[var(--km-rule)] bg-white p-5 shadow-[0_8px_24px_rgba(26,31,43,0.06)] transition-all hover:-translate-y-0.5 hover:border-[var(--km-blue)] hover:shadow-[0_12px_28px_rgba(26,31,43,0.10)]"
              >
                <span className="flex gap-3">
                  <Check
                    className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--km-success)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="text-sm leading-relaxed text-[var(--km-ink-soft)]">
                    {item.text}
                  </span>
                </span>
                <span className="ml-7 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--km-blue)]">
                  {item.cta}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    strokeWidth={2}
                    aria-hidden
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
