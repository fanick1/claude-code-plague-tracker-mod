import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PlagueSummary } from '../types'
import { bandColor, bar, commandText, fromSignals, fromSummary, sparkline, statusLine, trendText } from './summary'

const PANE = 'plague-tracker'
const DEFAULT_URL = 'https://plague-tracker-theta.vercel.app'
const USAGE = 'Usage: `/plague-tracker` shows the current threat level; `on` / `off` toggle the permanent display; `pane` opens the detail pane.'

const summary = atom({ plugin: 'plague-tracker', key: 'summary' } as const, null)
const error = atom({ plugin: 'plague-tracker', key: 'error' } as const, null)
const isOn = atom({ plugin: 'plague-tracker', key: 'isOn' } as const, false)

type Config = { base: string; display: 'band' | 'status'; refreshMs: number }

// The poll timer belongs to this load of the module; a reload drops it and session.start starts another.
let timer: Timer | undefined

async function fetchSummary($: EngineInterface, cfg: Config): Promise<PlagueSummary> {
  const compact = await $.http.fetch(`${cfg.base}/api/summary`).catch(() => null)
  if (compact?.ok) {
    const parsed = fromSummary(parseJson(compact.text))
    if (parsed) return { ...parsed, url: parsed.url || `${cfg.base}/` }
  }
  // Deployments from before /api/summary existed: derive the same from the full payload.
  const full = await $.http.fetch(`${cfg.base}/api/signals`)
  if (!full.ok) throw new Error(`HTTP ${full.status} from ${cfg.base}`)
  const parsed = fromSignals(parseJson(full.text), `${cfg.base}/`)
  if (!parsed) throw new Error(`unexpected response from ${cfg.base}/api/signals`)
  return parsed
}

async function refresh($: EngineInterface, cfg: Config): Promise<PlagueSummary | null> {
  try {
    const fresh = await fetchSummary($, cfg)
    await update($, summary, () => fresh)
    await update($, error, () => null)
    if (cfg.display === 'status' && (await read($, isOn))) $.ui.status(statusLine(fresh))
    return fresh
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, error, () => message)
    return null
  }
}

// Polls while the display is on or the pane is open; stops itself once neither holds.
function startPolling($: EngineInterface, cfg: Config) {
  timer?.cancel()
  timer = $.clock.every(cfg.refreshMs, async () => {
    const isPaneUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (!(await read($, isOn)) && !isPaneUp) {
      timer?.cancel()
      timer = undefined
      return
    }
    await refresh($, cfg)
  })
}

async function setOn($: EngineInterface, value: boolean) {
  await update($, isOn, () => value)
  await $.store.set('isOn', value)
}

export const register: Register = (on, options) => {
  const cfg: Config = {
    base: String(options.baseUrl || DEFAULT_URL).replace(/\/+$/, ''),
    display: options.display === 'status' ? 'status' : 'band',
    refreshMs: Math.max(1, Number(options.refreshMinutes) || 5) * 60_000,
  }
  const { display, refreshMs } = cfg

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plague-tracker',
      description: 'Plague outbreak threat level (on|off: permanent display, pane: details)',
      argumentHint: '[on|off|pane]',
    })
    // The on/off choice outlives the session; values in $.state survive a hot reload anyway.
    if ((await $.store.get('isOn')) === true) {
      await update($, isOn, () => true)
      void refresh($, cfg)
      startPolling($, cfg)
    }

    return next(e)
  })

  on('command.run', { command: 'plague-tracker' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on') {
      await setOn($, true)
      startPolling($, cfg)
      const fresh = await refresh($, cfg)
      const where = display === 'status' ? 'the status line' : 'the band above the prompt'
      return { text: `Plague tracker on: shown in ${where}, refreshed every ${refreshMs / 60_000} min.\n\n${fresh ? commandText(fresh) : unavailable(await read($, error))}` }
    }

    if (arg === 'off') {
      await setOn($, false)
      $.ui.status(undefined)
      await $.ui.close({ id: PANE })
      timer?.cancel()
      timer = undefined
      return { text: 'Plague tracker off.' }
    }

    if (arg === 'pane') {
      const fresh = await refresh($, cfg)
      const opened = await $.ui.open({ id: PANE, title: 'Plague tracker' })
      startPolling($, cfg)
      const note = opened.isPlaced ? 'Plague tracker pane opened.' : 'Plague tracker pane opens once the terminal is wide enough.'
      return { text: fresh ? note : `${note} ${unavailable(await read($, error))}` }
    }

    if (arg !== '') return { text: USAGE }

    const fresh = (await refresh($, cfg)) ?? (await read($, summary))
    if (!fresh) return { text: unavailable(await read($, error)) }
    const stale = (await read($, error)) ? `\n\n_Showing the last value fetched; refresh failed: ${await read($, error)}_` : ''
    return { text: commandText(fresh) + stale }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (display !== 'band' || e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const { Box, Text, Link } = $.ui.resolve(e)
    const s = await read($, summary)
    const err = await read($, error)
    if (!s) {
      return (
        <Box>
          <Text dimColor>☣ plague tracker: {err ? `unavailable (${err})` : 'loading…'}</Text>
        </Box>
      )
    }

    return (
      <Box>
        <Text color={bandColor(s.band)} bold>
          ☣ Plague threat {s.level.toFixed(1)}/100 {s.band}
        </Text>
        <Text> {trendText(s.delta24h)} </Text>
        <Text dimColor>{sparkline(s.spark)} </Text>
        {err !== null && <Text dimColor>(stale) </Text>}
        <Link href={s.url} label="[web]" />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    const s = await read($, summary)
    const err = await read($, error)
    if (!s) {
      return <Text dimColor>{err ? `Unavailable: ${err}` : 'Loading…'}</Text>
    }
    const labelWidth = Math.max(...s.signals.map(sig => sig.label.length), 0)

    return (
      <Box flexDirection="column">
        <Text color={bandColor(s.band)} bold>
          ☣ {s.level.toFixed(1)}/100 {s.band.toUpperCase()}
        </Text>
        <Text>
          {trendText(s.delta24h)} <Text dimColor>{sparkline(s.spark)} ({s.sparkSpan})</Text>
        </Text>
        <Text> </Text>
        {s.signals.map(sig => (
          <Text>
            {sig.label.padEnd(labelWidth)} <Text color={bandColor(bandOfNorm(sig.norm))}>{bar(sig.norm)}</Text>{' '}
            <Text dimColor>{Math.round(sig.norm * 100)}%</Text>
          </Text>
        ))}
        {s.cases && (
          <Text>
            {'\n'}Cases: {s.cases.confirmed} confirmed, {s.cases.suspected} suspected, {s.cases.deaths} deaths
          </Text>
        )}
        <Text dimColor>
          {'\n'}Computed {s.ts.slice(0, 16).replace('T', ' ')} UTC{err !== null ? ` · refresh failed: ${err}` : ''}
        </Text>
        <Box>
          <Link href={s.url} label="[web]" />
          <Text> </Text>
          <Button key="refresh" label="Refresh" onPress={() => void refresh($, cfg)} />
        </Box>
      </Box>
    )
  })
}

function bandOfNorm(norm: number) {
  return norm >= 0.75 ? 'severe' : norm >= 0.5 ? 'high' : norm >= 0.25 ? 'elevated' : 'low'
}

function unavailable(err: string | null): string {
  return `Plague tracker unavailable${err ? `: ${err}` : ''}.`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
