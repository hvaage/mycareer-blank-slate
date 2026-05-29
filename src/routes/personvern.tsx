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
          'Slik behandler Karrierenmin personopplysninger: hva vi samler inn, hvorfor, hvor lenge vi lagrer det og hvilke rettigheter du har.',
      },
      { property: 'og:title', content: 'Personvernerklæring — Karrierenmin' },
      {
        property: 'og:description',
        content:
          'Slik behandler Karrierenmin personopplysninger: hva vi samler inn, hvorfor, hvor lenge vi lagrer det og hvilke rettigheter du har.',
      },
    ],
  }),
})

const LAST_UPDATED = '29. mai 2026'

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

        <div className="prose prose-neutral mt-10 max-w-none text-foreground [&_a]:text-accent [&_a]:underline [&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:leading-relaxed [&_p]:text-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1">
          <h2>1. Behandlingsansvarlig</h2>
          <p>
            Karrierenmin ("vi", "oss") er behandlingsansvarlig for
            personopplysningene som behandles gjennom tjenesten på
            karrierenmin.no.
          </p>
          <p>
            Postadresse: St. Halvardsvei 2B, 1358 Jar.
            <br />
            Kontakt om personvern:{' '}
            <a href="mailto:hei@karrierenmin.no">hei@karrierenmin.no</a>.
            <br />
            Daglig ansvarlig:{' '}
            <a href="mailto:hvaage@gmail.com">hvaage@gmail.com</a>.
          </p>

          <h2>2. Hvilke opplysninger vi samler inn</h2>
          <ul>
            <li>
              <strong>Kontoopplysninger:</strong> e-post, navn og kryptert
              passord.
            </li>
            <li>
              <strong>Profildata:</strong> CV, jobbønsker, kompetanse, erfaring
              og notater du laster opp eller fyller inn.
            </li>
            <li>
              <strong>Innhold du lager:</strong> søknader, kontakter,
              vurderinger og oppfølgingsnotater.
            </li>
            <li>
              <strong>Tekniske data:</strong> IP-adresse, nettleser, enhet og
              bruksmønster (informasjonskapsler).
            </li>
            <li>
              <strong>Integrasjoner:</strong> data fra tjenester du selv kobler
              til, som LinkedIn og jobbportaler.
            </li>
          </ul>

          <h2>3. Formål og rettslig grunnlag</h2>
          <p>
            Vi behandler opplysningene for å levere og forbedre tjenesten,
            oppfylle avtalen med deg (GDPR art. 6 (1)(b)), og basert på
            berettiget interesse (art. 6 (1)(f)) for produktutvikling,
            feilsøking og sikkerhet. Markedsføring skjer kun med samtykke
            (art. 6 (1)(a)), som du når som helst kan trekke tilbake.
          </p>

          <h2>4. Deling av data</h2>
          <p>
            Vi selger aldri personopplysninger. Vi deler kun med databehandlere
            som leverer infrastruktur og funksjonalitet på vegne av oss, under
            skriftlige databehandleravtaler:
          </p>
          <ul>
            <li>Hosting og database (Lovable Cloud, innen EU/EØS).</li>
            <li>
              AI-modeller brukt til søknads- og selskapsanalyse (Anthropic
              Claude).
            </li>
            <li>
              Jobbportal- og profilintegrasjoner du selv aktiverer (Careerjet,
              LinkedIn).
            </li>
            <li>E-postutsendelse for transaksjons- og servicemeldinger.</li>
          </ul>
          <p>
            Dersom data overføres utenfor EU/EØS, sikrer vi et lovlig
            overføringsgrunnlag, typisk EUs standardkontrakter (SCC) med
            supplerende tiltak der det er nødvendig.
          </p>

          <h2>5. Lagringstid</h2>
          <p>
            Data lagres så lenge du har en aktiv konto. Du kan når som helst
            slette dataene dine eller hele kontoen fra konto-innstillingene,
            eller ved å kontakte{' '}
            <a href="mailto:hei@karrierenmin.no">hei@karrierenmin.no</a>.
            Enkelte opplysninger kan lagres lenger der loven krever det (f.eks.
            bokføring).
          </p>

          <h2>6. Dine rettigheter</h2>
          <p>Du har rett til å:</p>
          <ul>
            <li>få innsyn i hvilke opplysninger vi har om deg,</li>
            <li>få rettet uriktige opplysninger,</li>
            <li>be om sletting,</li>
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

          <h2>7. Informasjonskapsler (cookies)</h2>
          <p>
            Vi bruker nødvendige cookies for innlogging og funksjonalitet, samt
            valgfrie analytics-cookies for å forbedre tjenesten. Du gir
            samtykke ved første besøk og kan trekke det tilbake når som helst
            ved å tømme nettleserens lagring eller endre innstillingene i
            nettleseren.
          </p>

          <h2>8. Sikkerhet</h2>
          <p>
            All data overføres kryptert (TLS) og lagres sikkert. Vi bruker
            tilgangsstyring og prinsippet om minste privilegium, og tilgang er
            begrenset til autorisert personell. Ved et sikkerhetsbrudd som
            medfører risiko for dine rettigheter, varsler vi Datatilsynet og
            berørte personer i henhold til loven.
          </p>

          <h2>9. Endringer</h2>
          <p>
            Vi kan oppdatere denne erklæringen. Vesentlige endringer varsles
            per e-post eller i tjenesten. Gjeldende versjon vil alltid være
            tilgjengelig på denne siden.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
