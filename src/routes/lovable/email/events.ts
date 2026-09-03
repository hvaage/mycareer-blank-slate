import { createEmailWebhookHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute("/lovable/email/events")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const apiKey = process.env['LOVABLE_API_KEY']
        if (!apiKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }
        const record = async (
          eventId: string,
          recipient: string,
          reason: 'bounce' | 'complaint' | 'unsubscribe',
          status: 'bounced' | 'complained' | 'suppressed',
          message: string,
        ) => {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
          const normalized = recipient.toLowerCase()

          const { error: suppressError } = await supabaseAdmin
            .from('suppressed_emails')
            .upsert({ email: normalized, reason, metadata: null }, { onConflict: 'email' })
          if (suppressError) {
            console.error('Failed to upsert suppressed email', {
              event_id: eventId,
              error: { code: suppressError.code, message: suppressError.message },
            })
            throw new Error('Failed to write suppression')
          }

          const { error: logError } = await supabaseAdmin.from('email_send_log').insert({
            message_id: null,
            template_name: 'system',
            recipient_email: normalized,
            status,
            error_message: message,
            metadata: null,
          })
          if (logError) {
            console.error('Failed to insert email_send_log', {
              event_id: eventId,
              error: { code: logError.code, message: logError.message },
            })
            throw new Error('Failed to write send log')
          }
        }

        const handler = createEmailWebhookHandler({
          apiKey,
          on: {
            'email.bounced': async (event) => {
              await record(
                event.event_id,
                event.data.recipient,
                'bounce',
                'bounced',
                'Permanent bounce — email address is invalid or rejected',
              )
            },
            'email.complaint': async (event) => {
              await record(
                event.event_id,
                event.data.recipient,
                'complaint',
                'complained',
                'Spam complaint — recipient marked email as spam',
              )
            },
            'email.unsubscribed': async (event) => {
              await record(
                event.event_id,
                event.data.recipient,
                'unsubscribe',
                'suppressed',
                'Recipient unsubscribed',
              )
            },
          },
        })

        return handler(request)
      },
    },
  },
})
