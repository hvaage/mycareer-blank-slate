import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { LeadForm } from "@/components/selskapsanalyse/LeadForm";
import { DimensionsRadar } from "@/components/selskapsanalyse/DimensionsRadar";
import {
  DIMENSJONER,
  STEG,
  LAND,
  SELSKAPSANALYSE,
} from "@/lib/selskapsanalyse-site";

export const Route = createFileRoute("/selskapsanalyse")({
  head: () => ({
    meta: [
      { title: "Arbeidsgiveranalysen — Karrierenmin" },
      {
        name: "description",
        content: SELSKAPSANALYSE.defaultOgDescription,
      },
      { property: "og:title", content: "Arbeidsgiveranalysen — Karrierenmin" },
      {
        property: "og:description",
        content: SELSKAPSANALYSE.defaultOgDescription,
      },
      {
        property: "og:url",
        content: "https://karrierenmin.no/selskapsanalyse",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://karrierenmin.no/selskapsanalyse",
      },
    ],
  }),
  component: SelskapsanalysePage,
});

function SelskapsanalysePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-20">
            <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Gratis Claude skill · fra Karrierenmin.no
                </div>
                <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-serif tracking-tight text-foreground">
                  Vit hva du går til{" "}
                  <span className="text-primary">før du signerer.</span>
                </h1>
                <p className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed">
                  Arbeidsgiveranalysen gjør timer med arbeidsgiver-research om til
                  en godt dokumentert PDF-rapport — i åtte dimensjoner, ekte
                  kilder, klar til en 20-minutters gjennomlesning før neste
                  intervju.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href="#hent-den"
                    className="inline-flex h-12 items-center rounded-md bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Hent Claude-skillen — gratis
                  </a>
                  <a
                    href="/selskapsanalyse/eksempel-equinor-rapport.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center rounded-md border border-border bg-card px-6 text-base font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Se et eksempel på en arbeidsgiveranalyse →
                  </a>
                </div>

                <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check /> Bygget for Claude
                  </li>
                  <li className="flex items-center gap-2">
                    <Check /> 16 europeiske land · 12 språk
                  </li>
                  <li className="flex items-center gap-2">
                    <Check /> Standardrapport på 8–10 sider
                  </li>
                  <li className="flex items-center gap-2">
                    <Check /> Utvidet dybderapport opp mot 25 sider
                  </li>
                </ul>
              </div>

              {/* Form panel */}
              <div id="hent-den" className="lg:sticky lg:top-20">
                <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xl shadow-primary/5">
                  <h2 className="text-xl font-semibold text-foreground">
                    Hent Claude skillen og koble deg til oss på LinkedIn
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Få Claude skillen og en kort installasjonsguide rett i
                    innboksen.
                  </p>
                  <div className="mt-5">
                    <LeadForm />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
              Glassdoor-stjerner forteller deg ikke hvem du faktisk skal jobbe
              for.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              De fleste "arbeidsgiver-research" er et par karakterer fra
              omtalesider og et raskt LinkedIn-blikk. Arbeidsgiveranalysen går
              gjennom offentlige registre, bærekraftsrapportering,
              tilsynsrapporter og omtaleplattformer i landet hvor stillingen
              faktisk er — og scorer åtte dimensjoner med kildene knyttet på.
            </p>
          </div>
        </section>

        {/* What it does */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
            Hva hver rapport dekker
          </h2>
          <p className="mt-3 text-muted-foreground max-w-2xl">
            Åtte dimensjoner, scoret 1,0–5,0 med tydelig rubrikk. Velg mellom
            en <strong className="font-medium text-foreground">standardrapport på 8–10 sider</strong>{" "}
            eller en <strong className="font-medium text-foreground">utvidet dybderapport på opp mot 25 sider</strong>.
            Rapporten kan genereres på 12 språk. Markeres som{" "}
            <em className="not-italic font-medium text-foreground">
              utilstrekkelig grunnlag
            </em>{" "}
            når offentlige kilder ikke støtter en score.
          </p>

          <div className="mt-10 grid lg:grid-cols-[auto_1fr] gap-8 lg:gap-12 items-center">
            <figure className="mx-auto w-full max-w-[360px] sm:max-w-[400px] rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-foreground text-center mb-3">
                Eksempel på arbeidsgiver-scorekort
              </h3>
              <DimensionsRadar />
              <figcaption className="mt-3 text-xs text-muted-foreground text-center">
                Illustrasjon fra en eksempelrapport.
              </figcaption>
            </figure>

            <div className="grid sm:grid-cols-2 gap-4">
              {DIMENSJONER.map((f, i) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all"
                >
                  <div className="h-8 w-8 rounded-md bg-primary/10 text-primary grid place-items-center font-semibold text-xs">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="mt-3 font-semibold text-foreground">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
            Slik fungerer det
          </h2>
          <ol className="mt-10 grid md:grid-cols-3 gap-6">
            {STEG.map((s, i) => (
              <li
                key={s.title}
                className="relative rounded-xl border border-border bg-card p-6"
              >
                <div className="text-xs text-primary uppercase tracking-wider">
                  Steg {i + 1}
                </div>
                <h3 className="mt-2 font-semibold text-foreground text-lg">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Scope */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <div className="rounded-2xl border border-border bg-card p-8 sm:p-10">
            <h2 className="text-2xl sm:text-3xl font-serif tracking-tight text-foreground">
              Bygget for analyser av selskaper i 16 europeiske
              arbeidsmarkeder.
            </h2>
            <p className="mt-3 text-muted-foreground max-w-2xl">
              Claude skillen prioriterer den lokale enheten i landet hvor
              stillingen er, og henter fra land-spesifikke registre og
              rapporteringskrav — ikke bare globale ratinger.
            </p>
            <ul className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm text-foreground">
              {LAND.map((c) => (
                <li key={c} className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-3xl px-4 sm:px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-foreground">
            Start neste intervju med grundig forkunnskap om din mulige nye
            arbeidsgiver.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Gratis. Ingen betaling eller kortinformasjon nødvendig.
          </p>
          <a
            href="#hent-den"
            className="mt-8 inline-flex h-12 items-center rounded-md bg-primary px-8 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Hent Claude skillen
          </a>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function Check() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-primary"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
