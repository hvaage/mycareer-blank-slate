import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  firstName?: string
  email?: string
  linkedinUrl?: string
  role?: string | null
}

const ADMIN_EMAIL = 'hei@karrierenmin.no'

const SelskapsanalyseAdminVarsel = ({
  firstName,
  email,
  linkedinUrl,
  role,
}: Props) => (
  <Html lang="no" dir="ltr">
    <Head />
    <Preview>Ny lead fra Selskapsanalyse-siden</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Ny lead: Selskapsanalyse</Heading>
        <Text style={text}>
          <strong>Navn:</strong> {firstName || '—'}
          <br />
          <strong>E-post:</strong> {email || '—'}
          <br />
          <strong>LinkedIn:</strong>{' '}
          {linkedinUrl ? (
            <Link href={linkedinUrl} style={link}>
              {linkedinUrl}
            </Link>
          ) : (
            '—'
          )}
          <br />
          <strong>Rolle:</strong> {role || '—'}
        </Text>
        <Text style={footer}>
          Sendt fra karrierenmin.no/selskapsanalyse
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SelskapsanalyseAdminVarsel,
  subject: 'Ny lead fra Selskapsanalyse',
  displayName: 'Selskapsanalyse — admin-varsel',
  to: ADMIN_EMAIL,
  previewData: {
    firstName: 'Kari',
    email: 'kari@example.com',
    linkedinUrl: 'https://linkedin.com/in/kari-nordmann',
    role: 'Account Executive',
  },
} satisfies TemplateEntry
