import { FileText, BarChart3, ClipboardCheck, Compass } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { FeatureCard } from "./FeatureCard";

const steps = [
  {
    num: "01",
    title: "Profilering og oppsett",
    description:
      "Forstå deg selv: ønsker, mål, erfaringer, kompetanser og det du mangler. Sett opp integrasjoner og legg grunnlaget for at løsningen er tilpasset deg og din karriere.",
  },
  {
    num: "02",
    title: "Karrierelogging",
    description:
      "Hold kompetanser, erfaringer og resultater kontinuerlig oppdatert — planlegg og få innspill på videre kompetansebygging der det trengs eller der det kan gi deg nye muligheter.",
  },
  {
    num: "03",
    title: "Nettverk og synlighet",
    description:
      "Networking, LinkedIn-optimalisering, profilering og strukturert CRM mot nettverket ditt, rekrutterere og headhuntere.",
  },
  {
    num: "04",
    title: "Marked og arbeidsgiverinnsikt",
    description:
      "Analyser markedet og evaluer dagens og fremtidige potensielle arbeidsgivere, match mot egne kompetanser, verdier, ønsker og mål.",
  },
  {
    num: "05",
    title: "Søknadsprosessen",
    description:
      "Jobbannonser, CV, søknadsbrev, intervju, prioritering, matching, utvelgelse og oppfølging — samlet på ett sted.",
  },
  {
    num: "06",
    title: "Evaluering, forhandling og videreutvikling",
    description:
      "Hjelp til å vurdere oppgaver, jobbtilbud og kontrakter, og forberede 1:1-samtaler med din sjef. Hjelp til hva du kan gjøre for å lykkes bedre i din eksisterende jobb. Definer nye karrieremuligheter og legg opp et løp for å komme dit.",
  },
];

const items = [
  {
    icon: FileText,
    title: "Karriereprofil",
    description: "Samle erfaring, resultater og kompetanse i én strukturert profil.",
  },
  {
    icon: BarChart3,
    title: "Markedsinnsikt",
    description: "Forstå arbeidsmarkedet basert på NAV, SSB og analyser av stillinger.",
  },
  {
    icon: ClipboardCheck,
    title: "Dokumentasjon",
    description: "Valg og vurderinger lagres og kan etterprøves.",
  },
  {
    icon: Compass,
    title: "Beslutningsstøtte",
    description: "Ta beslutninger basert på strukturert informasjon.",
  },
];

export function What() {
  return (
    <section id="hva" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <SectionHeading eyebrow="Hva dette er" title="Et system for hele karrieren" />

        {/* Seks steg gjennom karriereløpet */}
        <div className="mt-16">
          <h3 className="text-xl font-semibold text-foreground md:text-2xl">
            Seks steg gjennom karriereløpet
          </h3>
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
            {steps.map((step) => (
              <div key={step.num} className="flex flex-col gap-4 bg-card p-8">
                <span className="font-serif text-3xl text-accent">{step.num}</span>
                <div>
                  <h4 className="text-base font-semibold text-foreground">{step.title}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
