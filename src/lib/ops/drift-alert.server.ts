/**
 * DRIFTSVARSLING — ENESTE TRANSPORTPUNKT
 * ======================================
 * All utsending av driftsvarsler går gjennom `sendDriftsvarsel`. Ingen annen
 * kode skal vite hvordan e-post sendes. Skal transporten byttes,
 * er det denne filen som endres — ingen andre.
 *
 * Varselet har egen emnelinje og håndskrevet HTML, og sendes derfor direkte
 * gjennom Lovables håndterte e-post-API i stedet for malregisteret.
 * Undertrykkelse og avmelding håndteres på plattformsiden.
 */
import { EmailAPIError, sendLovableEmail } from '@lovable.dev/email-js'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

export type DriftSeverity = 'info' | 'warning' | 'critical'

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

  async function loggFørsøk(status: 'sent' | 'suppressed' | 'failed', feil?: string) {
    const { error: loggFeil } = await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.label ?? 'drift-varsel',
      recipient_email: mottaker,
      status,
      ...(feil ? { error_message: feil.slice(0, 1000) } : {}),
    })
    if (loggFeil) {
      console.error('[drift] klarte ikke å logge varsel', {
        error: { code: loggFeil.code, message: loggFeil.message },
      })
    }
  }

  const apiKey = process.env['LOVABLE_API_KEY']
  if (!apiKey) {
    const error = 'LOVABLE_API_KEY mangler — driftsvarsler kan ikke sendes'
    console.error('[drift]', error)
    return { ok: false, error }
  }

  try {
    await sendLovableEmail(
      {
        to: mottaker,
        from: `${FROM_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: opts.label ?? 'drift-varsel',
        idempotency_key: opts.idempotencyKey ?? messageId,
      },
      { apiKey, sendUrl: process.env['LOVABLE_SEND_URL'] },
    )
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === 'recipient_suppressed') {
      await loggFørsøk('suppressed')
      console.warn('[drift] varsel ble stoppet av undertrykkelse', { subject })
      return { ok: false, error: 'recipient_suppressed' }
    }
    const melding = error instanceof Error ? error.message : String(error)
    await loggFørsøk('failed', melding)
    console.error('[drift] klarte ikke å sende varsel', { subject, error: melding })
    return { ok: false, error: melding }
  }

  await loggFørsøk('sent')

  console.log('[drift] varsel sendt', { subject, message_id: messageId })
  return { ok: true, messageId }
}
