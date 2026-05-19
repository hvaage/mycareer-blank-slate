import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const DOWNLOAD_URL = 'https://karrierenmin.no/selskapsanalyse/employer-analysis.skill'
const LINKEDIN_URL = 'https://www.linkedin.com/company/karrierenmin/?trk=follow'

interface Props {
  firstName?: string
}

const SelskapsanalyseBekreftelse = ({ firstName }: Props) => (
  <Html lang="no" dir="ltr">
    <Head />
    <Preview>Last ned Claude-skillen for Selskapsanalyse</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {firstName ? `Hei ${firstName}!` : 'Hei!'}
        </Heading>
        <Text style={text}>
          Takk for at du hentet Selskapsanalyse-skillen fra Karrierenmin.no.
          Klikk på knappen under for å laste ned skill-filen og legge den til i Claude.
        </Text>
        <Section style={buttonSection}>
          <Button href={DOWNLOAD_URL} style={button}>
            Last ned Claude-skillen
          </Button>
        </Section>
        <Text style={text}>
          Hvis knappen ikke fungerer, kopier denne lenken inn i nettleseren:
          <br />
          <Link href={DOWNLOAD_URL} style={link}>
            {DOWNLOAD_URL}
          </Link>
        </Text>
        <Heading as="h2" style={h2}>
          Slik tar du den i bruk
        </Heading>
        <Text style={text}>
          1. Åpne Claude (claude.ai) og gå til <strong>Skills</strong>.
          <br />
          2. Last opp <em>employer-analysis.skill</em>-filen du nettopp lastet ned.
          <br />
          3. Start en ny samtale, oppgi selskapets domene og land — Claude gjør resten.
        </Text>
        <Text style={text}>
          Følg gjerne <Link href={LINKEDIN_URL} style={link}>Karrierenmin på LinkedIn</Link>{' '}
          for å få vite når vi lanserer flere verktøy.
        </Text>
        <Text style={footer}>Hilsen teamet bak Karrierenmin.no</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SelskapsanalyseBekreftelse,
  subject: 'Claude-skillen din er klar til nedlasting',
  displayName: 'Selskapsanalyse — bekreftelse',
  previewData: { firstName: 'Kari' },
} satisfies TemplateEntry
