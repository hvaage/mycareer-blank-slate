import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const TAKK_BASE = 'https://karrierenmin.no/selskapsanalyse/takk'
const CONNECT_URL = 'https://www.linkedin.com/in/henrikvaage'
const FOLLOW_URL = 'https://www.linkedin.com/company/karrierenmin/?trk=follow'

interface Props {
  firstName?: string
  token?: string
}

function buildTakkUrl(token?: string): string {
  return token ? `${TAKK_BASE}?token=${encodeURIComponent(token)}` : TAKK_BASE
}


const SelskapsanalyseBekreftelse = ({ firstName }: Props) => (
  <Html lang="no" dir="ltr">
    <Head />
    <Preview>Last ned Claude-skillen for Arbeidsgiveranalysen</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {firstName ? `Hei ${firstName}!` : 'Hei!'}
        </Heading>
        <Text style={text}>
          Takk for at du hentet Arbeidsgiveranalysen-skillen fra Karrierenmin.no.
          Klikk på knappen under for å låse opp og laste ned skill-filen.
        </Text>
        <Section style={buttonSection}>
          <Button href={TAKK_URL} style={button}>
            Lås opp og last ned
          </Button>
        </Section>
        <Text style={textSmall}>
          Direkte lenke til filen:{' '}
          <Link href={DOWNLOAD_URL} style={link}>
            {DOWNLOAD_URL}
          </Link>
        </Text>

        <Hr style={hr} />

        <Heading as="h2" style={h2}>
          Følg Karrierenmin på LinkedIn
        </Heading>
        <Text style={text}>
          Vi sender deg en kort e-post når vi lanserer nye verktøy som dette.
          I mellomtiden er det fint om du{' '}
          <Link href={CONNECT_URL} style={link}>
            kobler til Henrik Vaage
          </Link>{' '}
          eller{' '}
          <Link href={FOLLOW_URL} style={link}>
            følger Karrierenmin.no
          </Link>{' '}
          — det er sånn vi holder prosjektet i gang.
        </Text>
        <Section style={buttonSection}>
          <Button href={FOLLOW_URL} style={linkedinButton}>
            Følg Karrierenmin.no
          </Button>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={h2}>
          Slik installerer du skillen i Claude
        </Heading>
        <Text style={text}>
          Skills er en funksjon i Claude som lar deg laste opp egne ferdigheter
          Claude kan bruke i samtaler. Du trenger en{' '}
          <strong>Claude Pro-, Max-, Team- eller Enterprise-konto</strong> for
          å bruke Skills.
        </Text>
        <Text style={text}>
          <strong>1. Last ned skill-filen</strong>
          <br />
          Bruk knappen øverst i e-posten eller{' '}
          <Link href={DOWNLOAD_URL} style={link}>
            direktelenken
          </Link>{' '}
          for å lagre <em>employer-analysis.skill</em> på maskinen din.
        </Text>
        <Text style={text}>
          <strong>2. Åpne Skills i Claude</strong>
          <br />
          Logg inn på{' '}
          <Link href="https://claude.ai" style={link}>
            claude.ai
          </Link>
          . Klikk på profilen din nede til venstre →{' '}
          <strong>Settings</strong> → <strong>Capabilities</strong> →{' '}
          <strong>Skills</strong>. (På mobil: menyen øverst til venstre →{' '}
          <strong>Settings</strong>.)
        </Text>
        <Text style={text}>
          <strong>3. Last opp filen</strong>
          <br />
          Trykk <strong>Upload skill</strong> og velg{' '}
          <em>employer-analysis.skill</em>. Slå deretter på bryteren slik at
          skillen er aktiv.
        </Text>
        <Text style={text}>
          <strong>4. Start en ny samtale</strong>
          <br />
          Åpne en ny chat og skriv f.eks.: <em>
            «Bruk Arbeidsgiveranalysen-skillen og lag en rapport om
            equinor.com i Norge.»
          </em>{' '}
          Claude spør om domene, land og om du vil ha standard (8–10 sider)
          eller utvidet rapport (opp mot 25 sider), og leverer en PDF når
          den er klar.
        </Text>
        <Text style={textSmall}>
          Tips: Skills er foreløpig kun tilgjengelig i Claude på web og
          desktop — ikke i mobil-appen. Får du ikke opp <strong>Skills</strong>{' '}
          i menyen, sjekk at kontoen din er på Pro eller høyere.
        </Text>


        <Text style={footer}>Hilsen Henrik og teamet bak Karrierenmin.no</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SelskapsanalyseBekreftelse,
  subject: 'Claude-skillen din er klar til nedlasting',
  displayName: 'Arbeidsgiveranalysen — bekreftelse',
  previewData: { firstName: 'Kari' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#0a0a0a', margin: '0 0 16px' }
const h2 = { fontSize: '18px', fontWeight: 'bold', color: '#0a0a0a', margin: '24px 0 12px' }
const text = { fontSize: '15px', color: '#3f3f46', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '13px', color: '#52525b', lineHeight: '1.5', margin: '0 0 16px' }
const buttonSection = { margin: '20px 0', textAlign: 'center' as const }
const button = {
  backgroundColor: '#0a0a0a',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontWeight: 600,
  fontSize: '15px',
  textDecoration: 'none',
}
const linkedinButton = {
  backgroundColor: '#0A66C2',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontWeight: 600,
  fontSize: '15px',
  textDecoration: 'none',
}
const link = { color: '#0a0a0a', textDecoration: 'underline' }
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const footer = { fontSize: '13px', color: '#71717a', margin: '24px 0 0' }
