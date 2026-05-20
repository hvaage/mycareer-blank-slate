import { createFileRoute } from '@tanstack/react-router'
import { Header } from '@/components/landing/Header'
import { Footer } from '@/components/landing/Footer'

export const Route = createFileRoute('/personvern')({
  component: PersonvernPage,
  head: () => ({
    meta: [
      { title: 'Personvernerklæring — Karrierenmin' },
      {
        name: 'description',
        content:
          'Slik behandler Karrierenmin.no personopplysninger: hva vi samler inn, hvorfor, hvor lenge vi lagrer det og hvilke rettigheter du har.',
      },
      { property: 'og:title', content: 'Personvernerklæring — Karrierenmin' },
      {
        property: 'og:description',
        content:
          'Slik behandler Karrierenmin.no personopplysninger: hva vi samler inn, hvorfor, hvor lenge vi lagrer det og hvilke rettigheter du har.',
      },
    ],
  }),
})

const LAST_UPDATED = '20. mai 2026'

function PersonvernPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Personvern
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Personvernerklæring
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Sist oppdatert: {LAST_UPDATED}
        </p>

        <div className="prose prose-neutral mt-10 max-w-none text-foreground [&_a]:text-accent [&_a]:underline [&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:leading-relaxed [&_p]:text-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1">
          <h2>1. Innledning</h2>
          <p>
            Karrierenmin.no (“Karrierenmin”, “vi”, “oss”) er et system for å forstå,
            dokumentere og styre egen karriere. Vi tar personvern på alvor og
            behandler personopplysninger i samsvar med personopplysningsloven og
            EUs personvernforordning (GDPR).
          </p>
          <p>
            Denne erklæringen forklarer hvilke opplysninger vi samler inn når du
            besøker karrierenmin.no eller bruker tjenestene våre (inkludert
            Arbeidsgiveranalysen og andre Claude-skills vi tilbyr), hvorfor vi
            samler dem inn, hvor lenge vi lagrer dem og hvilke rettigheter du har.
          </p>

          <h2>2. Behandlingsansvarlig</h2>
          <p>
            Karrierenmin er behandlingsansvarlig for personopplysninger som
            behandles via nettstedet og tjenestene våre. Kontakt:{' '}
            <a href="mailto:hei@karrierenmin.no">hei@karrierenmin.no</a>.
          </p>

          <h2>3. Hvilke opplysninger vi samler inn</h2>
          <h3>3.1 Opplysninger du gir oss</h3>
          <ul>
            <li>
              <strong>Kontakt- og profilopplysninger:</strong> navn, e-postadresse,
              LinkedIn-profil og lignende informasjon du oppgir i skjemaer (for
              eksempel ved nedlasting av Arbeidsgiveranalysen eller registrering
              av bruker).
            </li>
            <li>
              <strong>Karriereinformasjon:</strong> stillinger, erfaringer,
              ferdigheter, mål og annet innhold du selv legger inn for å bruke
              tjenesten.
            </li>
            <li>
              <strong>Henvendelser:</strong> innhold i e-poster og meldinger du
              sender oss.
            </li>
          </ul>
          <h3>3.2 Opplysninger som samles inn automatisk</h3>
          <ul>
            <li>
              <strong>Tekniske data:</strong> IP-adresse, nettlesertype, operativ­system,
              referrer og tidspunkt for besøk.
            </li>
            <li>
              <strong>Bruksdata:</strong> hvilke sider du besøker, hvor lenge,
              klikk og interaksjon, samt hvordan e-poster fra oss åpnes og
              klikkes (når mulig).
            </li>
            <li>
              <strong>Informasjonskapsler (cookies):</strong> brukes for å holde
              deg innlogget, huske preferanser og måle bruk. Du kan slå av cookies
              i nettleseren, men da kan deler av tjenesten slutte å fungere.
            </li>
          </ul>

          <h2>4. Hvorfor vi behandler opplysningene (formål og rettslig grunnlag)</h2>
          <ul>
            <li>
              <strong>Levere tjenesten</strong> — opprette og drifte konto,
              levere Claude-skills, sende ut nedlastinger og bekreftelser.
              Rettslig grunnlag: avtale (GDPR art. 6 (1)(b)).
            </li>
            <li>
              <strong>Kommunikasjon</strong> — svare på henvendelser, sende
              servicemeldinger og viktige oppdateringer. Rettslig grunnlag:
              avtale og berettiget interesse (art. 6 (1)(b) og (f)).
            </li>
            <li>
              <strong>Markedsføring og nyhetsbrev</strong> — sende informasjon
              om nye funksjoner, skills og innhold. Rettslig grunnlag: samtykke
              (art. 6 (1)(a)). Du kan når som helst melde deg av via lenke i
              e-posten eller ved å kontakte oss.
            </li>
            <li>
              <strong>Forbedring og analyse</strong> — forstå hvordan tjenesten
              brukes, feilsøke og forbedre brukeropplevelsen. Rettslig grunnlag:
              berettiget interesse (art. 6 (1)(f)).
            </li>
            <li>
              <strong>Rettslige forpliktelser</strong> — for eksempel bokføring
              og svar på lovpålagte henvendelser. Rettslig grunnlag: rettslig
              forpliktelse (art. 6 (1)(c)).
            </li>
          </ul>

          <h2>5. Deling av opplysninger</h2>
          <p>
            Vi selger ikke personopplysninger. Vi deler kun opplysninger med
            databehandlere som leverer tjenester på vegne av oss, under skriftlig
            databehandleravtale. Typiske kategorier:
          </p>
          <ul>
            <li>Hosting og database (skyleverandører i EU/EØS).</li>
            <li>E-postutsendelse (transaksjons- og markedsføringspost).</li>
            <li>Analyse- og feilsøkingsverktøy.</li>
            <li>AI-modellleverandører som benyttes for å levere funksjonalitet.</li>
          </ul>
          <p>
            Vi kan også utlevere opplysninger når vi er rettslig forpliktet til
            det, eller for å beskytte våre rettigheter.
          </p>

          <h2>6. Overføring utenfor EU/EØS</h2>
          <p>
            Enkelte av våre underleverandører kan behandle data utenfor EU/EØS.
            Når dette skjer, sørger vi for et lovlig overføringsgrunnlag, typisk
            EUs standardkontrakter (SCC) og supplerende tiltak der det er
            nødvendig.
          </p>

          <h2>7. Lagringstid</h2>
          <ul>
            <li>
              <strong>Kontoer og innhold:</strong> så lenge du har en aktiv konto
              hos oss. Du kan når som helst be om å få kontoen slettet.
            </li>
            <li>
              <strong>Leads og nedlastinger:</strong> inntil 24 måneder etter
              siste interaksjon, deretter slettes eller anonymiseres dataene.
            </li>
            <li>
              <strong>E-postlogger:</strong> inntil 12 måneder for feilsøking og
              dokumentasjon av leveranse.
            </li>
            <li>
              <strong>Lovpålagt lagring</strong> (f.eks. bokføringspliktige
              opplysninger): så lenge loven krever.
            </li>
          </ul>

          <h2>8. Sikkerhet</h2>
          <p>
            Vi gjennomfører tekniske og organisatoriske tiltak for å beskytte
            personopplysninger, blant annet kryptering i transport, tilgangs­styring,
            logging og prinsippet om minste privilegium. Ved et eventuelt
            sikkerhetsbrudd som medfører risiko for dine rettigheter, varsler vi
            Datatilsynet og berørte personer i henhold til loven.
          </p>

          <h2>9. Dine rettigheter</h2>
          <p>Du har rett til å:</p>
          <ul>
            <li>få innsyn i hvilke opplysninger vi har om deg,</li>
            <li>få rettet uriktige opplysninger,</li>
            <li>be om sletting (“retten til å bli glemt”),</li>
            <li>be om begrensning av behandlingen,</li>
            <li>protestere mot behandling basert på berettiget interesse,</li>
            <li>be om dataportabilitet,</li>
            <li>trekke tilbake samtykke når som helst.</li>
          </ul>
          <p>
            Send forespørsler til{' '}
            <a href="mailto:hei@karrierenmin.no">hei@karrierenmin.no</a>. Du kan
            også klage til Datatilsynet (
            <a
              href="https://www.datatilsynet.no"
              target="_blank"
              rel="noreferrer"
            >
              datatilsynet.no
            </a>
            ).
          </p>

          <h2>10. Informasjonskapsler</h2>
          <p>
            Vi bruker nødvendige cookies for innlogging og drift av nettstedet,
            og kan bruke analyse-cookies for å forstå bruk. Du kan administrere
            cookies i nettleseren din. Mer detaljert cookie-oversikt publiseres
            ved behov.
          </p>

          <h2>11. Barn</h2>
          <p>
            Tjenesten er ikke rettet mot barn under 16 år, og vi samler ikke
            bevisst inn opplysninger om barn.
          </p>

          <h2>12. Endringer</h2>
          <p>
            Vi kan oppdatere denne erklæringen. Ved vesentlige endringer
            informerer vi på nettstedet eller per e-post. Gjeldende versjon vil
            alltid være tilgjengelig på denne siden.
          </p>

          <h2>13. Kontakt</h2>
          <p>
            Spørsmål om personvern? Kontakt oss på{' '}
            <a href="mailto:hei@karrierenmin.no">hei@karrierenmin.no</a>.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
