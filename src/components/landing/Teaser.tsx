import { Building2, Star, MapPin, CreditCard } from "lucide-react";

const bars = [
  { label: "Produktledelse", pct: 85, tone: "var(--km-accent-sage)" },
  { label: "Salg", pct: 55, tone: "var(--km-accent-sage)" },
  { label: "IT-drift", pct: 25, tone: "var(--km-ink-faint)" },
];

function ExampleBadge() {
  return (
    <span className="rounded-full bg-[#3A2F22] px-2.5 py-0.5 text-[11px] font-medium text-[var(--km-accent-warm)]">
      Eksempel
    </span>
  );
}

function CardShell({
  icon: Icon,
  title,
  children,
  note,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
  note: string;
}) {
  return (
    <div className="rounded-[10px] border border-[#313C50] bg-[#20293A] p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--km-blue-deep)]">
            <Icon className="h-4 w-4 text-[#8FB3E0]" strokeWidth={1.75} aria-hidden />
          </div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <ExampleBadge />
      </div>
      <div className="mt-4 rounded-lg bg-[#181F2C] p-4">{children}</div>
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--km-ink-faint)]">
        {note}
      </p>
    </div>
  );
}

export function Teaser() {
  return (
    <section id="markedsinnsikt" className="bg-[#181F2C]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="text-center">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-[#8FB3E0]">
            Innsikt du får underveis
          </p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.25] text-white">
            Fire ting du kan sjekke allerede i dag
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--km-ink-faint)]">
            Karrieren min gir deg mer enn dokumentasjon — du får løpende innsikt i
            markedet du søker i.
          </p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <CardShell
            icon={Building2}
            title="Arbeidsgiveranalyse"
            note="Se størrelse, vekst og signaler om en arbeidsgiver før du søker — eller før du tar kontakt."
          >
            <p className="text-sm font-semibold text-white">Acme Norge AS</p>
            <p className="mt-1 text-[13px] text-[var(--km-ink-faint)]">
              340 ansatte · Vekst siste 12 mnd: +12 % · 6 åpne stillinger
            </p>
          </CardShell>

          <CardShell
            icon={Star}
            title="Vurderinger av arbeidsgivere"
            note="Les hva tidligere og nåværende ansatte faktisk sier, samlet ett sted."
          >
            <p className="text-sm font-semibold text-white">
              4,2 / 5{" "}
              <span className="ml-1 text-[13px] font-normal text-[var(--km-ink-faint)]">
                28 vurderinger
              </span>
            </p>
            <p className="mt-1 text-[13px] italic text-[var(--km-ink-faint)]">
              «Godt lederskap, høyt tempo, tydelige forventninger.»
            </p>
          </CardShell>

          <CardShell
            icon={MapPin}
            title="Behov i ditt område"
            note="Se hvor etterspørselen faktisk er, i ditt fagfelt og din region."
          >
            <ul className="space-y-2.5">
              {bars.map((bar) => (
                <li key={bar.label}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[var(--km-ink-faint)]">{bar.label}</span>
                    <span className="font-mono text-[var(--km-ink-faint)]">
                      {bar.pct} %
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#313C50]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${bar.pct}%`, background: bar.tone }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardShell>

          <CardShell
            icon={CreditCard}
            title="Lønn per stilling"
            note="Vit hva stillingen faktisk lønner før du forhandler."
          >
            <p className="text-[13px] text-[var(--km-ink-faint)]">Produktsjef, Oslo</p>
            <p className="mt-1 text-[15px] font-semibold text-[#7FA8DC]">
              850 000 – 1 100 000 kr
            </p>
          </CardShell>
        </div>
      </div>
    </section>
  );
}
