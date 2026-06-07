import { SectionHeading } from "./SectionHeading";

const steps = [
  {
    num: "01",
    title: "Profilering og oppsett",
    description: "Forstå deg selv: ønsker, mål, erfaringer, kompetanser og det du mangler. Sett opp integrasjoner og grunnlaget for resten av løpet.",
  },
  {
    num: "02",
    title: "Kontinuerlig oppdatering",
    description: "Hold kompetanser, erfaringer og resultater oppdatert — og planlegg videre kompetansebygging der det trengs.",
  },
  {
    num: "03",
    title: "Nettverk og synlighet",
    description: "Networking, LinkedIn-optimalisering, profilering og strukturert CRM mot rekrutterere og headhuntere.",
  },
  {
    num: "04",
    title: "Marked og arbeidsgiverinnsikt",
    description: "Analyser markedet og potensielle arbeidsgivere, og matche mot egne verdier, ønsker og mål.",
  },
  {
    num: "05",
    title: "Søknadsprosessen A til Å",
    description: "Jobbannonser, CV, søknadsbrev, intervju, prioritering, matching, utvelgelse og oppfølging — samlet på ett sted.",
  },
  {
    num: "06",
    title: "Evaluering og forhandling",
    description: "Hjelp til å vurdere oppgaver, jobbtilbud og kontrakter, og forberede 1:1-samtaler med din sjef.",
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
