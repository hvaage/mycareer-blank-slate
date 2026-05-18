import { SectionHeading } from "./SectionHeading";

const steps = [
  {
    num: "01",
    title: "Hent inn muligheter",
    description: "Koble e-post og importer jobber, kombinert med offentlige data.",
  },
  {
    num: "02",
    title: "Bygg karriereprofil",
    description: "Dokumenter erfaring, resultater og kvalifikasjoner.",
  },
  {
    num: "03",
    title: "Få markedsinnsikt",
    description: "Forstå roller, arbeidsgivere og etterspørsel.",
  },
  {
    num: "04",
    title: "Evaluer og prioriter",
    description: "Vurder hvilke muligheter som er riktige.",
  },
  {
    num: "05",
    title: "Gjennomfør søknadsprosessen",
    description: "Lag CV og søknader, bruk nettverk og følg opp.",
  },
  {
    num: "06",
    title: "Vurder tilbud",
    description: "Sammenlign alternativer og ta beslutninger.",
  },
];

export function How() {
  return (
    <section id="hvordan" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading
          eyebrow="Hvordan det fungerer"
          title="Seks steg gjennom karriereløpet"
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div key={step.num} className="flex flex-col gap-4 bg-card p-8">
              <span className="font-serif text-3xl text-accent">{step.num}</span>
              <div>
                <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
