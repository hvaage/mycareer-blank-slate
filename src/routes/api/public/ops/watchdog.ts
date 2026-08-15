/**
 * VAKTJOBB — HTTP-INNGANG
 * =======================
 * Kalles av pg_cron hver time. Ruten ligger under /api/public/ fordi cron
 * ikke har en brukersesjon; sikkerheten er delt hemmelighet i header.
 *
 *   POST ?action=run    normal kjøring
 *   POST ?action=dry    kjører kontrollene uten å sende eller skrive
 *   POST ?action=test   sender ett testvarsel
 *
 * Kunstig feiltilstand (verifisering): ?action=run&override_source=nav&override_min=1
 */
import { createFileRoute } from '@tanstack/react-router'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  const len = Math.max(ab.length, bb.length, 1)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < len; i++) diff |= (i < ab.length ? ab[i]! : 0) ^ (i < bb.length ? bb[i]! : 0)
  return diff === 0
}

export const Route = createFileRoute('/api/public/ops/watchdog')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env['OPS_WATCHDOG_SECRET']
        const recipient = process.env['OPS_ALERT_EMAIL']
        const mangler = [
          ...(secret ? [] : ['OPS_WATCHDOG_SECRET']),
          ...(recipient ? [] : ['OPS_ALERT_EMAIL']),
        ]
        if (mangler.length > 0) {
          console.error('[watchdog] manglende konfigurasjon', mangler)
          return json({ ok: false, error: 'manglende konfigurasjon', mangler }, 503)
        }

        // To likeverdige kallere: manuelt kall med delt hemmelighet, eller
        // pg_cron som sender tjenestenøkkelen fra vault som Bearer.
        const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
        const given = request.headers.get('x-ops-secret') ?? ''
        const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
        const authorized =
          (given !== '' && timingSafeEqualStr(given, secret!)) ||
          (bearer !== '' && serviceKey !== '' && timingSafeEqualStr(bearer, serviceKey))
        if (!authorized) {
          return json({ ok: false, error: 'ugyldig hemmelighet' }, 401)
        }

        const url = new URL(request.url)
        const action = url.searchParams.get('action') ?? 'run'

        try {
          if (action === 'test') {
            const { sendDriftsvarsel } = await import('@/lib/ops/drift-alert.server')
            const res = await sendDriftsvarsel(
              'Testvarsel fra vaktjobben',
              [
                'Dette er en testutsending for å bekrefte at driftsvarsling virker.',
                '',
                `Sendt: ${new Date().toISOString()}`,
                'Kilde: manuelt utløst test',
                'Neste steg: ingen. Kom denne frem, er transporten verifisert.',
              ].join('\n'),
              'info',
              { label: 'drift-test' },
            )
            return json(res, res.ok ? 200 : 500)
          }

          const { runWatchdog } = await import('@/lib/ops/watchdog.server')
          const overrideSource = url.searchParams.get('override_source')
          const overrideMin = Number(url.searchParams.get('override_min') ?? '')
          const override =
            overrideSource && Number.isFinite(overrideMin)
              ? { source: overrideSource, stilleGrenseMin: overrideMin }
              : null

          const result = await runWatchdog({ dryRun: action === 'dry', override })
          return json(result)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('[watchdog] kjøring feilet', msg)
          return json({ ok: false, error: msg }, 500)
        }
      },
    },
  },
})
