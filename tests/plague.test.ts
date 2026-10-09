import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { fromSignals, fromSummary, sparkline, trendText } from '../hooks/summary'

const BASE = 'https://plague-tracker-theta.vercel.app'

const SUMMARY = {
  level: 57.8,
  band: 'high',
  ts: '2026-10-09T04:00:00.000Z',
  change24h: { from: 55.1, delta: 2.7, trend: 'up' },
  hourly: [55.1, 55.3, 56, 56.2, 57.8],
  signals: [
    { key: 'news_volume', label: 'News volume', value: 171, norm: 0.968 },
    { key: 'social_chatter', label: 'Social chatter', value: 16, norm: 0.298 },
  ],
  cases: { confirmed: 0, suspected: 2, deaths: 1 },
  lastPollAt: '2026-10-09T03:45:11.000Z',
  url: `${BASE}/`,
}

const SIGNALS = {
  latest: {
    cases_total: { ts: 't', value: 2, norm: 0.3, meta: { confirmed: 0, suspected: 2, deaths: 1 } },
    news_volume: { ts: 't', value: 171, norm: 0.968, meta: {} },
    threat_level: { ts: '2026-10-09T04:00:00.000Z', value: 57.8, norm: 0.578, meta: {} },
  },
  history: { threat_level: [{ ts: 'a', value: 40, norm: 0.4 }, { ts: 'b', value: 60, norm: 0.6 }, { ts: 'c', value: 57.8, norm: 0.578 }] },
  threatBand: 'high',
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The world beneath the plugin: an in-memory store and clock, the tracker's HTTP API, and the ui calls it makes. */
// Defaults to a person who turned the display off, so each test starts quiet unless it says otherwise.
function world(on: On, routes: Record<string, unknown>, store: Record<string, unknown> = { isOn: false }) {
  const calls = { fetched: [] as string[], status: [] as (string | undefined)[], opened: [] as string[], closed: [] as string[] }
  const stored: Record<string, unknown> = { ...store }
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-09T04:00:00Z') })
  on('http.fetch', ($, e) => {
    calls.fetched.push(e.url)
    const path = e.url.slice(BASE.length)
    const body = routes[path]
    const headers: Record<string, string> = {}
    return body === undefined
      ? { value: { status: 404, ok: false, headers, text: 'not found' } }
      : { value: { status: 200, ok: true, headers, text: JSON.stringify(body) } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    calls.status.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    calls.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    calls.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  // The engine's own band: empty, so a plugin that passes on draws nothing of its own.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-band' }))
  return { calls, clock, stored }
}

function run($: Engine, args: string) {
  return $.command.run({
    command: 'plague-tracker',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

describe('parsing', () => {
  test('reads /api/summary', () => {
    const s = fromSummary(SUMMARY)
    expect(s).toMatchObject({ level: 57.8, band: 'high', delta24h: 2.7, sparkSpan: '24h', url: `${BASE}/` })
    expect(s?.signals).toHaveLength(2)
  })

  test('derives the same from /api/signals', () => {
    const s = fromSignals(SIGNALS, `${BASE}/`)
    expect(s).toMatchObject({ level: 57.8, band: 'high', delta24h: -2.2, sparkSpan: '14d', cases: { suspected: 2, deaths: 1 } })
    expect(s?.signals.map(sig => sig.label)).toEqual(['Cases', 'News volume'])
  })

  test('rejects payloads without a level', () => {
    expect(fromSummary({ error: 'x' })).toBe(null)
    expect(fromSignals({ latest: {} }, BASE)).toBe(null)
  })

  test('formats trend and sparkline', () => {
    expect(trendText(2.7)).toBe('▲ +2.7/24h')
    expect(trendText(-0.4)).toBe('► -0.4/24h')
    expect(trendText(0)).toBe('► ±0.0/24h')
    expect(trendText(null)).toBe('? 24h')
    expect(sparkline([1, 2, 3])).toBe('▁▅█')
    expect(sparkline([5, 5])).toBe('▁▁')
  })
})

describe('/plague-tracker', () => {
  test('bare command shows level, 24h trend and a [web] link', async ($, on) => {
    const { calls } = world(on, { '/api/summary': SUMMARY })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const out = await run($, '')
    expect(out.text).toContain('Plague threat 57.8/100 (high)')
    expect(out.text).toContain('▲ +2.7/24h')
    expect(out.text).toContain(`[web](${BASE}/)`)
    expect(calls.fetched).toEqual([`${BASE}/api/summary`])
  })

  test('falls back to /api/signals on older deployments', async ($, on) => {
    const { calls } = world(on, { '/api/signals': SIGNALS })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const out = await run($, '')
    expect(out.text).toContain('57.8/100 (high)')
    expect(out.text).toContain('▼ -2.2/24h')
    expect(calls.fetched).toEqual([`${BASE}/api/summary`, `${BASE}/api/signals`])
  })

  test('says so when the tracker is down', async ($, on) => {
    world(on, {})
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const out = await run($, '')
    expect(out.text).toContain('Plague tracker unavailable: HTTP 404')
  })

  test('on draws the band with a [web] link and polls; off clears it', async ($, on) => {
    const { calls, clock, stored } = world(on, { '/api/summary': SUMMARY })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    for (const surface of ['terminal', 'desktop'] as const) {
      const quiet = await $.ui.mount({ plugin: 'plague-tracker', surface, ...BAND })
      expect(await quiet.find({ text: /Plague threat/ })).toBeUndefined()
      await quiet.unmount()
    }

    const out = await run($, 'on')
    expect(out.text).toContain('band above the prompt')
    expect(stored.isOn).toBe(true)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'plague-tracker', surface, ...BAND })
      expect((await band.find({ text: /Plague threat/ }))?.text).toContain('57.8/100 high')
      expect(await band.find({ type: 'Link', text: '[web]' })).toBeDefined()
      await band.unmount()
    }

    const before = calls.fetched.length
    await clock.advance(30 * 60_000)
    expect(calls.fetched.length).toBe(before + 1)

    await run($, 'off')
    expect(stored.isOn).toBe(false)
    expect(calls.closed).toEqual(['plague-tracker'])
    const band = await $.ui.mount({ plugin: 'plague-tracker', surface: 'terminal', ...BAND })
    expect(await band.find({ text: /Plague threat/ })).toBeUndefined()

    const after = calls.fetched.length
    await clock.advance(60 * 60_000)
    expect(calls.fetched.length).toBe(after)
  })

  test('status display pins one plain line', { options: { display: 'status' } }, async ($, on) => {
    const { calls } = world(on, { '/api/summary': SUMMARY })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await run($, 'on')
    expect(calls.status.at(-1)).toMatch(/^☣ plague 57\.8 high ▲ \+2\.7\/24h [▁-█]+$/)
    await run($, 'off')
    expect(calls.status.at(-1)).toBeUndefined()
  })

  test('is on by default after install', async ($, on) => {
    const { calls } = world(on, { '/api/summary': SUMMARY }, {})
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const band = await $.ui.mount({ plugin: 'plague-tracker', surface: 'terminal', ...BAND })
    expect((await band.find({ text: /Plague threat/ }))?.text).toContain('57.8/100 high')
    expect(calls.fetched).toEqual([`${BASE}/api/summary`])
  })

  test('the on state outlives the session', async ($, on) => {
    const { calls } = world(on, { '/api/summary': SUMMARY }, { isOn: true })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const band = await $.ui.mount({ plugin: 'plague-tracker', surface: 'terminal', ...BAND })
    expect((await band.find({ text: /Plague threat/ }))?.text).toContain('57.8')
    expect(calls.fetched.length).toBeGreaterThan(0)
  })

  test('pane shows signals, cases and a working Refresh', async ($, on) => {
    const { calls } = world(on, { '/api/summary': SUMMARY })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await run($, 'pane')
    expect(calls.opened).toEqual(['plague-tracker'])
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({
        plugin: 'plague-tracker',
        surface,
        component: 'Pane',
        requestId: 'plague-tracker',
        props: { title: 'Plague tracker', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
      })
      expect(await pane.find({ text: /News volume/ })).toBeDefined()
      expect(await pane.find({ text: /2 suspected, 1 deaths/ })).toBeDefined()
      const before = calls.fetched.length
      await pane.press({ key: 'refresh' })
      expect(calls.fetched.length).toBe(before + 1)
      await pane.unmount()
    }
  })

  test('unknown argument prints usage', async ($, on) => {
    world(on, {})
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect((await run($, 'bogus')).text).toContain('Usage')
  })
})
