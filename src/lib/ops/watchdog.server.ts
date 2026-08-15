/**
 * VAKTJOBB — ÉN JOBB SOM SER PÅ ALLE KILDENE
 * ==========================================
 * Varsling bygges ikke inn i hver synkjobb. Én vaktjobb ser på alle, fordi den
 * også fanger tilfellet der en jobb ikke kjører i det hele tatt — den viktigste
 * feilen, siden en stoppet jobb ikke sier fra selv.
 *
 * Vaktjobben overvåker også seg selv via hjerteslag i public.ops_heartbeat.
 *
 * Transporten ligger i drift-alert.server.ts. Denne filen vet ikke hvordan
 * e-post sendes.
 */
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { sendDriftsvarsel, type DriftSeverity } from './drift-alert.server'

const ADMIN_URL = (process.env['SITE_URL'] ?? 'https://karrierenmin.no').replace(/\/$/, '')
const RENOTIFY_MS = 24 * 60 * 60 * 1000
const PARTIAL_STREAK_LIMIT = 3
/** Uvanlig vekst i brreg_full_missing_count tyder på ufullstendig fullfil. */
const MISSING_RATIO_ALARM = 0.02
/** En startet enhetsimport som ikke har flyttet seg på to timer regnes som stanset. */
const BRREG_STALL_MIN = 120

export interface SourceConfig {
  key: string
  navn: string
  /** Forventet intervall, kun for tekst i varselet. */
  intervall: string
  /** Varsle når det ikke finnes vellykket kjøring på så mange minutter. */
  stilleGrenseMin: number
  /** Forventet varighet; kjøringer over 2x regnes som hengt. */
  forventetVarighetMin: number
  /** Kan vaktjobben rydde (markere failed)? */
  kanRyddes: boolean
  adminSti: string
}

export const SOURCES: SourceConfig[] = [
  {
    key: 'brreg_enheter',
    navn: 'Enhetsimport (BRREG fullfil)',
    intervall: '14 dager',
    stilleGrenseMin: 16 * 24 * 60,
    forventetVarighetMin: 6 * 60,
    kanRyddes: true,
    adminSti: '/admin/ingestion',
  },
  {
    key: 'regnskap',
    navn: 'regnskap-sync-15min',
    intervall: '15 minutter',
    stilleGrenseMin: 60,
    forventetVarighetMin: 5,
    kanRyddes: true,
    adminSti: '/admin/regnskap',
  },
  {
    key: 'nav',
    navn: 'NAV-synk',
    intervall: '30 minutter',
    stilleGrenseMin: 90,
    forventetVarighetMin: 10,
    kanRyddes: false,
    adminSti: '/admin/nav-sync',
  },
  {
    key: 'careerjet',
    navn: 'Careerjet-synk',
    intervall: '6 timer',
    stilleGrenseMin: 12 * 60,
    forventetVarighetMin: 20,
    kanRyddes: true,
    adminSti: '/admin/sync',
  },
]

/** Vaktjobbens eget hjerteslag: 1 time forventet, varsle etter 3 timer. */
const HEARTBEAT_ALERT_MIN = 180

type Issue = {
  key: string
  source: string
  severity: DriftSeverity
  title: string
  body: string
  details: Record<string, unknown>
}

function minutesSince(ts: string | null | undefined, now: number): number | null {
  if (!ts) return null
  return Math.round((now - new Date(ts).getTime()) / 60000)
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return 'aldri'
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function link(sti: string): string {
  return `${ADMIN_URL}${sti}`
}

/** Overstyring av stillegrensen for kunstig fremkalt feiltilstand (punkt 7). */
export type WindowOverride = { source: string; stilleGrenseMin: number } | null

export async function runWatchdog(opts: { dryRun?: boolean; override?: WindowOverride } = {}) {
  const now = Date.now()
  const issues: Issue[] = []
  const reaped: Array<{ source: string; count: number; ids: unknown }> = []

  const { data: snapshot, error: snapErr } = await supabaseAdmin.rpc('ops_watchdog_snapshot' as never)
  if (snapErr) throw new Error(`ops_watchdog_snapshot: ${snapErr.message}`)
  const snap = snapshot as any
  const sources = (snap?.sources ?? {}) as Record<string, any>

  // ---- 0. Hjerteslag: vaktjobben sjekker sin egen forrige kjøring FØR den skriver ny.
  const heartbeat = snap?.heartbeat as { last_beat_at?: string } | null
  const hbMin = minutesSince(heartbeat?.last_beat_at, now)
  if (heartbeat && hbMin !== null && hbMin > HEARTBEAT_ALERT_MIN) {
    issues.push({
      key: 'watchdog:heartbeat',
      source: 'watchdog',
      severity: 'critical',
      title: 'Vaktjobben har ikke kjørt',
      body:
        `Vaktjobben skal kjøre hver time, men forrige hjerteslag var ${fmt(heartbeat.last_beat_at)} — ` +
        `${hbMin} minutter siden. I dette vinduet har ingen kilder vært overvåket.\n\n` +
        `Neste steg: sjekk at cron-jobben 'ops-watchdog-1h' står som aktiv, og se på siste leveranser i cron-loggen.\n` +
        `Admin: ${link('/admin/sync')}`,
      details: { last_beat_at: heartbeat.last_beat_at, minutes: hbMin },
    })
  }

  for (const cfg of SOURCES) {
    const s = sources[cfg.key] ?? {}
    const stilleGrense =
      opts.override && opts.override.source === cfg.key ? opts.override.stilleGrenseMin : cfg.stilleGrenseMin

    // ---- 1. Uteblitt kjøring (viktigst)
    const sinceSuccess = minutesSince(s.last_success_at, now)
    if (sinceSuccess === null || sinceSuccess > stilleGrense) {
      issues.push({
        key: `${cfg.key}:stale`,
        source: cfg.key,
        severity: 'critical',
        title: `${cfg.navn}: ingen vellykket kjøring`,
        body:
          `Kilde: ${cfg.navn}\nForventet intervall: ${cfg.intervall}\n` +
          `Siste vellykkede kjøring: ${fmt(s.last_success_at)}` +
          (sinceSuccess !== null ? ` (${sinceSuccess} minutter siden)` : '') +
          `\nGrense for varsling: ${stilleGrense} minutter\n` +
          `Siste kjøring uansett status: ${fmt(s.last_run_at)} (${s.last_status ?? 'ukjent'})\n` +
          (s.last_error ? `Siste feilmelding: ${s.last_error}\n` : '') +
          `\nNeste steg: kontroller at cron-jobben er aktiv og at siste leveranse ikke feiler.\n` +
          `Admin: ${link(cfg.adminSti)}`,
        details: { last_success_at: s.last_success_at, minutes: sinceSuccess, grense: stilleGrense },
      })
    }

    // ---- 2. Feilet kjøring
    if (s.last_status === 'failed') {
      issues.push({
        key: `${cfg.key}:failed`,
        source: cfg.key,
        severity: 'critical',
        title: `${cfg.navn}: siste kjøring feilet`,
        body:
          `Kilde: ${cfg.navn}\nKjøring: ${s.last_run_id ?? 'ukjent'}\nAvsluttet: ${fmt(s.last_run_at)}\n` +
          `Feilmelding: ${s.last_error ?? '(ingen feilmelding lagret)'}\n\n` +
          `Neste steg: les feilmeldingen over, og se om neste planlagte kjøring retter seg selv.\n` +
          `Admin: ${link(cfg.adminSti)}`,
        details: { run_id: s.last_run_id, error: s.last_error },
      })
    }

    // ---- 3. Delvis kjøring tre ganger på rad
    const streak = Number(s.partial_streak ?? 0)
    if (streak >= PARTIAL_STREAK_LIMIT) {
      issues.push({
        key: `${cfg.key}:partial`,
        source: cfg.key,
        severity: 'warning',
        title: `${cfg.navn}: delvis kjøring ${streak} ganger på rad`,
        body:
          `Kilde: ${cfg.navn}\nAntall delvise kjøringer på rad: ${streak}\n` +
          `Siste kjøring: ${fmt(s.last_run_at)}\n` +
          (s.last_error ? `Siste feilmelding: ${s.last_error}\n` : '') +
          `\nÉn delvis kjøring er ofte datakvalitet i kilden. ${streak} på rad er et mønster.\n` +
          `Neste steg: se på hvilke poster som feiler i kjøringsloggen.\n` +
          `Admin: ${link(cfg.adminSti)}`,
        details: { streak },
      })
    }

    // ---- 4. Kjøring som ikke fullfører — rydd og si fra
    const stuckMin = minutesSince(s.running_oldest_started_at, now)
    const stuckGrense = cfg.forventetVarighetMin * 2
    if (stuckMin !== null && stuckMin > stuckGrense) {
      let ryddet: any = null
      if (cfg.kanRyddes && !opts.dryRun) {
        const { data, error } = await supabaseAdmin.rpc('ops_reap_stuck_runs' as never, {
          p_source: cfg.key,
          p_older_than_minutes: stuckGrense,
        } as never)
        if (error) console.error('[watchdog] rydding feilet', { source: cfg.key, error: error.message })
        else {
          ryddet = data
          reaped.push({ source: cfg.key, count: (data as any)?.reaped ?? 0, ids: (data as any)?.ids })
        }
      }
      issues.push({
        key: `${cfg.key}:stuck`,
        source: cfg.key,
        severity: 'warning',
        title: `${cfg.navn}: kjøring har hengt`,
        body:
          `Kilde: ${cfg.navn}\nAntall kjøringer i status running: ${s.running_count}\n` +
          `Eldste startet: ${fmt(s.running_oldest_started_at)} (${stuckMin} minutter siden)\n` +
          `Grense: ${stuckGrense} minutter (to ganger forventet varighet på ${cfg.forventetVarighetMin} minutter)\n` +
          (ryddet
            ? `\nVaktjobben har markert ${ryddet.reaped} kjøring(er) som failed: ${JSON.stringify(ryddet.ids)}\n`
            : cfg.kanRyddes
              ? `\nIngen rydding utført (tørrkjøring).\n`
              : `\nDenne kilden ryddes ikke automatisk — kjøringen må avsluttes manuelt.\n`) +
          `\nNeste steg: kontroller om jobben faktisk kjører, eller om låsen ble liggende igjen.\n` +
          `Admin: ${link(cfg.adminSti)}`,
        details: { stuck_minutes: stuckMin, running_count: s.running_count, ryddet },
      })
    }
  }

  // ---- 5. Enhetsimport spesielt: porten og manglende rader
  const brreg = snap?.brreg_last_run as any
  if (brreg) {
    if (brreg.gate_pass === false || brreg.status === 'gate_failed') {
      const gate = brreg.gate ?? {}
      issues.push({
        key: 'brreg_enheter:gate',
        source: 'brreg_enheter',
        severity: 'critical',
        title: 'Enhetsimport: porten stoppet importen',
        body:
          `Kjøring: ${brreg.run_id}\nFase: ${brreg.phase}\nStatus: ${brreg.status}\n\n` +
          `Porttall:\n${JSON.stringify(gate, null, 2)}\n\n` +
          `Ingenting er skrevet til speilet. Neste steg: vurder avvikene i porttallene over, ` +
          `og kjør fase 3 på nytt først når avviket er forklart.\n` +
          `Admin: ${link('/admin/ingestion')}`,
        details: { run_id: brreg.run_id, gate },
      })
    }
    // ---- 5b. Startet, men står stille. Dette er hullet i alle de andre
    // kontrollene: de måler uteblitt kjøring, ikke stillestående kjøring.
    // Importen kjøres i to jobber (start 1. og 15., driver hvert 5. minutt).
    // Står driveren, blir kjøringen liggende halvferdig uten at noe feiler.
    const terminal = brreg.status === 'ok' || brreg.status === 'failed' || brreg.status === 'gate_failed'
    const sisteBevegelse = brreg.updated_at ?? brreg.started_at
    const stilleMin = minutesSince(sisteBevegelse, now)
    if (!terminal && !brreg.finished_at && stilleMin !== null && stilleMin > BRREG_STALL_MIN) {
      issues.push({
        key: 'brreg_enheter:stalled',
        source: 'brreg_enheter',
        severity: 'critical',
        title: 'Enhetsimport: startet, men står stille',
        body:
          `Kjøring: ${brreg.run_id}\nFase: ${brreg.phase}\nStatus: ${brreg.status}\n` +
          `Startet: ${fmt(brreg.started_at)}\nSiste bevegelse: ${fmt(sisteBevegelse)} (${stilleMin} minutter siden)\n` +
          `Grense: ${BRREG_STALL_MIN} minutter\n` +
          `Rader sett: ${brreg.rows_seen ?? 0}, mellomlagret: ${brreg.rows_staged ?? 0}, skrevet: ${brreg.rows_upserted ?? 0}\n\n` +
          `Importen kjøres i to jobber: startjobben oppretter kjøringen, driverjobben ` +
          `'brreg-enheter-full-driver' flytter den ett steg om gangen. Startjobben rapporterer ` +
          `suksess selv om driveren står, så en stanset driver gir ingen feilet kjøring.\n\n` +
          `Neste steg: kontroller at cron-jobben 'brreg-enheter-full-driver' er aktiv og at ` +
          `siste leveranse svarer 200. Ingenting er skrevet feil — kjøringen fortsetter der den slapp ` +
          `så snart driveren går igjen.\n` +
          `Admin: ${link('/admin/ingestion')}`,
        details: {
          run_id: brreg.run_id,
          phase: brreg.phase,
          status: brreg.status,
          stille_minutter: stilleMin,
          grense: BRREG_STALL_MIN,
        },
      })
    }

    const upserted = Number(brreg.rows_upserted ?? 0)
    const missing = Number(brreg.rows_missing ?? 0)
    if (upserted > 0 && missing / upserted > MISSING_RATIO_ALARM) {
      issues.push({
        key: 'brreg_enheter:missing',
        source: 'brreg_enheter',
        severity: 'warning',
        title: 'Enhetsimport: uvanlig mange enheter manglet i fullfilen',
        body:
          `Kjøring: ${brreg.run_id}\nSkrevet: ${upserted}\nManglet i fullfilen: ${missing} ` +
          `(${((missing / upserted) * 100).toFixed(2)} %, grense ${(MISSING_RATIO_ALARM * 100).toFixed(0)} %)\n\n` +
          `Dette kan bety at fullfilen var ufullstendig. Ingenting er slettet — telleren ` +
          `brreg_full_missing_count er økt for de berørte radene.\n` +
          `Neste steg: sammenlign filstørrelsen mot forrige kjøring før neste import.\n` +
          `Admin: ${link('/admin/ingestion')}`,
        details: { run_id: brreg.run_id, upserted, missing },
      })
    }
  }

  // ---- 6. Tilstandsmaskin: første gang, maks én gang per døgn, og melding når løst
  const { data: stateRows, error: stateErr } = await supabaseAdmin
    .from('ops_alert_state')
    .select('*')
    .is('resolved_at', null)
  if (stateErr) throw new Error(`ops_alert_state: ${stateErr.message}`)

  const open = new Map<string, any>((stateRows ?? []).map((r: any) => [r.alert_key, r]))
  const active = new Set(issues.map((i) => i.key))
  const sent: string[] = []
  const suppressed: string[] = []
  const resolved: string[] = []

  for (const issue of issues) {
    const prev = open.get(issue.key)
    const lastNotified = prev?.last_notified_at ? new Date(prev.last_notified_at).getTime() : 0
    const skalVarsle = !prev || now - lastNotified > RENOTIFY_MS
    const nowIso = new Date().toISOString()

    if (skalVarsle && !opts.dryRun) {
      const sidenNaar = prev?.first_seen_at ? `\nOppdaget første gang: ${fmt(prev.first_seen_at)}` : ''
      const res = await sendDriftsvarsel(issue.title, issue.body + sidenNaar, issue.severity, {
        idempotencyKey: `${issue.key}:${nowIso.slice(0, 13)}`,
        label: `drift-${issue.source}`,
      })
      if (!res.ok) throw new Error(`sendDriftsvarsel: ${res.error}`)
      sent.push(issue.key)
    } else if (!skalVarsle) {
      suppressed.push(issue.key)
    }

    if (!opts.dryRun) {
      await supabaseAdmin.from('ops_alert_state').upsert(
        {
          alert_key: issue.key,
          source: issue.source,
          severity: issue.severity,
          title: issue.title,
          details: issue.details as never,
          last_seen_at: nowIso,
          updated_at: nowIso,
          resolved_at: null,
          ...(skalVarsle
            ? { last_notified_at: nowIso, notify_count: (prev?.notify_count ?? 0) + 1 }
            : {}),
          ...(prev ? {} : { first_seen_at: nowIso }),
        } as never,
        { onConflict: 'alert_key' },
      )
    }
  }

  for (const [key, row] of open) {
    if (active.has(key)) continue
    resolved.push(key)
    if (opts.dryRun) continue
    const nowIso = new Date().toISOString()
    await sendDriftsvarsel(
      `LØST: ${row.title}`,
      `Tilstanden er ikke lenger til stede.\n\nKilde: ${row.source}\nVarsel: ${key}\n` +
        `Oppdaget: ${fmt(row.first_seen_at)}\nLøst: ${fmt(nowIso)}\n` +
        `Antall varsler underveis: ${row.notify_count}\n\nIngen handling kreves.`,
      'info',
      { idempotencyKey: `${key}:resolved:${nowIso.slice(0, 13)}`, label: `drift-${row.source}` },
    )
    await supabaseAdmin
      .from('ops_alert_state')
      .update({ resolved_at: nowIso, updated_at: nowIso } as never)
      .eq('alert_key', key)
  }

  // ---- 7. Skriv hjerteslag til slutt, slik at en kjøring som kræsjer ikke teller
  if (!opts.dryRun) {
    await supabaseAdmin.from('ops_heartbeat').upsert(
      {
        name: 'watchdog',
        last_beat_at: new Date().toISOString(),
        details: { issues: issues.length, sent: sent.length, resolved: resolved.length } as never,
      } as never,
      { onConflict: 'name' },
    )
  }

  return {
    ok: true,
    dryRun: !!opts.dryRun,
    issues: issues.map((i) => ({ key: i.key, severity: i.severity, title: i.title })),
    sent,
    suppressed,
    resolved,
    reaped,
  }
}
