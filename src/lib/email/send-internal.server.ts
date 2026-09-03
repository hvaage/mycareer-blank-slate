import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { sendTemplateEmail } from '@/lib/email-templates/send-email'

/**
 * Server-internal transactional email sender for public/unauthenticated
 * triggers (e.g. lead form). Sends through Lovables håndterte e-post-API.
 * Undertrykkelse, forsøk på nytt og avmelding håndteres på plattformsiden.
 * Denne funksjonen skriver kun historikk til `email_send_log`.
 */
export async function sendTransactionalInternal(params: {
  templateName: string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, any>
}): Promise<{ success: boolean; reason?: string; error?: string }> {
  const { templateName, recipientEmail, templateData = {} } = params

  async function logSend(
    status: 'sent' | 'suppressed' | 'failed',
    recipient: string,
    errorMessage?: string,
  ) {
    const { error } = await supabaseAdmin.from('email_send_log').insert({
      message_id: null,
      template_name: templateName,
      recipient_email: recipient,
      status,
      ...(errorMessage ? { error_message: errorMessage.slice(0, 1000) } : {}),
    })
    if (error) {
      console.error('[email] klarte ikke å logge sending', {
        template_name: templateName,
        status,
        error: { code: error.code, message: error.message },
      })
    }
  }

  try {
    const result = await sendTemplateEmail(templateName, recipientEmail ?? '', {
      templateData,
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    })

    if (!result.sent) {
      await logSend('suppressed', recipientEmail ?? '')
      return { success: false, reason: 'email_suppressed' }
    }

    await logSend('sent', recipientEmail ?? '')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logSend('failed', recipientEmail ?? '', message)
    return { success: false, error: message }
  }
}
