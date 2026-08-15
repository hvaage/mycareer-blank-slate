/**
 * DRIFTSVARSLING — ENESTE TRANSPORTPUNKT
 * ======================================
 * All utsending av driftsvarsler går gjennom `sendDriftsvarsel`. Ingen annen
 * kode skal vite hvordan e-post sendes. Skal transporten byttes (spor B),
 * er det denne filen som endres — ingen andre.
 *
 * KRITISK REGEL: driftsvarsler sjekker ALDRI undertrykkelseslisten
 * (`suppressed_emails`). Et varsel om at synken har stoppet må frem selv om
 * adressen har meldt seg av noe annet. Derfor kaller vi `enqueue_email`
 * direkte i stedet for `sendTransactionalInternal`, som gjør
 * undertrykkelsessjekk og krever et registrert malnavn.
 *
 * Det legges heller ikke ved avmeldingslenke: dette er driftstelemetri til én
 * fast, konfigurert adresse, ikke e-post til en sluttbruker.
 */
import { supabaseAdmin } from '@/integrations/supabase/client.server'

export type DriftSeverity = 'info' | 'warning' | 'critical'

const QUEUE = 'transactional_emails'
const SENDER_DOMAIN = 'notify.karrierenmin.no'
const FROM_DOMAIN = 'karrierenmin.no'
const FROM_NAME = 'Karrierenmin drift'
const SUBJECT_PREFIX = '[karrierenmin drift]'

const SEVERITY_LABEL: Record<DriftSeverity, string> = {
  info: 'INFO',
  warning: 'ADVARSEL',
  critical: 'KRITISK',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface DriftvarselResultat {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Sender ett driftsvarsel. Manglende konfigurasjon feiler høyt — den skal
 * aldri degradere stille til «ingen varsling».
 */
export async function sendDriftsvarsel(
  emne: string,
  innhold: string,
  alvorlighet: DriftSeverity = 'warning',
  opts: { idempotencyKey?: string; label?: string } = {},
): Promise<DriftvarselResultat> {
  const mottaker = process.env['OPS_ALERT_EMAIL']
  if (!mottaker) {
    const error = 'OPS_ALERT_EMAIL mangler — driftsvarsler kan ikke sendes'
    console.error('[drift]', error)
    return { ok: false, error }
  }

  const messageId = crypto.randomUUID()
  const subject = `${SUBJECT_PREFIX} ${SEVERITY_LABEL[alvorlighet]}: ${emne}`
  const text = innhold.trimEnd() + '\n'
  const html =
    `<!doctype html><html lang="no"><body style="background:#ffffff;margin:0;padding:24px;">` +
    `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:1.6;color:#111827;max-width:720px;">` +
    `<div style="font-weight:700;margin-bottom:12px;">${escapeHtml(subject)}</div>` +
    `<pre style="white-space:pre-wrap;margin:0;font:inherit;">${escapeHtml(text)}</pre>` +
    `<div style="margin-top:24px;color:#6b7280;font-size:12px;">Driftsvarsel fra karrierenmin. Denne adressen er konfigurert for overvåking og kan ikke meldes av.</div>` +
    `</div></body></html>`

  // Avmeldingstoken kreves av e-post-API-et. Vi henter eller oppretter det, men
  // sjekker ALDRI suppressed_emails: en avmelding skal ikke slå av driftsovervåking.
  const normalized = mottaker.toLowerCase()
  let unsubscribeToken: string | null = null
  const { data: eksisterende } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalized)
    .maybeSingle()
  if (eksisterende?.token) {
    unsubscribeToken = eksisterende.token
  } else {
    const nytt = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .upsert({ token: nytt, email: normalized }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: lagret } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalized)
      .maybeSingle()
    unsubscribeToken = lagret?.token ?? nytt
  }

  const { error } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: QUEUE,
    payload: {
      message_id: messageId,
      to: mottaker,
      from: `${FROM_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: opts.label ?? 'drift-varsel',
      idempotency_key: opts.idempotencyKey ?? messageId,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    } as never,
  } as never)

  if (error) {
    console.error('[drift] klarte ikke å legge varsel i kø', { subject, error: error.message })
    return { ok: false, error: error.message }
  }

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: 'drift-varsel',
    recipient_email: mottaker,
    status: 'pending',
  })

  console.log('[drift] varsel lagt i kø', { subject, message_id: messageId })
  return { ok: true, messageId }
}
