import { SectionHeading } from "./SectionHeading";

const steps = [
  {
    num: "01",
    title: "Bygg karriereprofil",
    description: "Samle erfaring, kompetanse og resultater i én strukturert profil du eier selv.",
  },
  {
    num: "02",
    title: "Analyser stillingsannonser",
    description: "Forstå hva annonsen faktisk etterspør av kompetanse, erfaring og kvalifikasjoner.",
  },
  {
    num: "03",
    title: "Forstå arbeidsgiveren",
    description: "Få innsikt i selskapet, rollen og hva som kjennetegner en god match.",
  },
  {
    num: "04",
    title: "Lag CV og søknadsbrev",
    description: "Tilpass utkast basert på din egen erfaring og det den konkrete rollen krever.",
  },
  {
    num: "05",
    title: "Forbered intervju",
    description: "Jobb gjennom relevante spørsmål og eksempler før du møter arbeidsgiver.",
  },
  {
    num: "06",
    title: "Følg opp søknadsprosessen",
    description: "Hold oversikt over søknader, dialoger og neste steg på ett sted.",
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
