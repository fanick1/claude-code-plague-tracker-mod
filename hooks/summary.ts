// Pure parsing and formatting of the tracker's API; no `$`, so tests cover it directly.
import type { PlagueBand, PlagueSignal, PlagueSummary } from '../types'

const BANDS: readonly PlagueBand[] = ['low', 'elevated', 'high', 'severe']
const LABELS: Record<string, string> = {
  cases_total: 'Cases',
  news_volume: 'News volume',
  news_tone: 'News tone',
  official_who: 'WHO activity',
  denial_index: 'Denial index',
  public_interest: 'Public interest',
  social_chatter: 'Social chatter',
}
const BLOCKS = '▁▂▃▄▅▆▇█'

export function bandOf(level: number): PlagueBand {
  if (level >= 75) return 'severe'
  if (level >= 50) return 'high'
  if (level >= 25) return 'elevated'
  return 'low'
}

export function bandColor(band: PlagueBand): string {
  return { low: 'success', elevated: 'warning', high: '#f97316', severe: 'error' }[band]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The compact `/api/summary` payload. */
export function fromSummary(json: unknown): PlagueSummary | null {
  const j = json as Record<string, any>
  const level = num(j?.level)
  if (level === null || !Array.isArray(j.hourly)) return null
  return {
    level,
    band: BANDS.includes(j.band) ? j.band : bandOf(level),
    delta24h: num(j.change24h?.delta),
    spark: j.hourly.filter((v: unknown) => num(v) !== null),
    sparkSpan: '24h',
    signals: Array.isArray(j.signals) ? j.signals.map(toSignal).filter((s: PlagueSignal | null): s is PlagueSignal => s !== null) : [],
    cases: j.cases && typeof j.cases === 'object' ? casesOf(j.cases) : null,
    url: typeof j.url === 'string' ? j.url : '',
    ts: typeof j.ts === 'string' ? j.ts : '',
  }
}

/** Fallback for deployments without /api/summary: the full `/api/signals` payload (daily history). */
export function fromSignals(json: unknown, url: string): PlagueSummary | null {
  const j = json as Record<string, any>
  const latest = j?.latest?.threat_level
  const level = num(latest?.value)
  if (level === null) return null
  const history: number[] = (j.history?.threat_level ?? []).map((p: any) => num(p?.value)).filter((v: number | null) => v !== null)
  const dayAgo = history.length >= 2 ? (history[history.length - 2] ?? null) : null
  const signals = Object.entries(j.latest as Record<string, any>)
    .filter(([key]) => key !== 'threat_level')
    .map(([key, p]) => toSignal({ key, value: p?.value, norm: p?.norm }))
    .filter((s): s is PlagueSignal => s !== null)
  const meta = j.latest.cases_total?.meta
  return {
    level: round1(level),
    band: BANDS.includes(j.threatBand) ? j.threatBand : bandOf(level),
    delta24h: dayAgo === null ? null : round1(level - dayAgo),
    spark: history.map(round1),
    sparkSpan: '14d',
    signals,
    cases: meta && typeof meta === 'object' ? casesOf(meta) : null,
    url,
    ts: typeof latest.ts === 'string' ? latest.ts : '',
  }
}

function toSignal(s: any): PlagueSignal | null {
  const value = num(s?.value)
  const norm = num(s?.norm)
  if (typeof s?.key !== 'string' || value === null || norm === null) return null
  return { key: s.key, label: typeof s.label === 'string' ? s.label : (LABELS[s.key] ?? s.key), value, norm }
}

function casesOf(c: any) {
  return { confirmed: num(c.confirmed) ?? 0, suspected: num(c.suspected) ?? 0, deaths: num(c.deaths) ?? 0 }
}

/** Unicode block sparkline, scaled to the series' own range (min height for a flat series). */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo
  return values
    .map(v => BLOCKS[span < 0.05 ? 0 : Math.round(((v - lo) / span) * (BLOCKS.length - 1))])
    .join('')
}

/** `▲ +2.7`, `▼ -1.4`, `► ±0.3`; `?` when unknown. Within ±1 point counts as flat, as the tracker does. */
export function trendText(delta: number | null): string {
  if (delta === null) return '? 24h'
  const arrow = delta > 1 ? '▲' : delta < -1 ? '▼' : '►'
  const sign = delta > 0 ? '+' : delta < 0 ? '' : '±'
  return `${arrow} ${sign}${delta.toFixed(1)}/24h`
}

/** One plain line, for the status line (no link markup). */
export function statusLine(s: PlagueSummary): string {
  return `☣ plague ${s.level.toFixed(1)} ${s.band} ${trendText(s.delta24h)} ${sparkline(s.spark)}`
}

/** Markdown for the command's transcript row; the `[web]` link is drawn as a link there. */
export function commandText(s: PlagueSummary): string {
  const lines = [
    `**☣ Plague threat ${s.level.toFixed(1)}/100 (${s.band})** · ${trendText(s.delta24h)} · \`${sparkline(s.spark)}\` (${s.sparkSpan}) · [web](${s.url})`,
  ]
  if (s.cases) {
    lines.push(`Cases: ${s.cases.confirmed} confirmed, ${s.cases.suspected} suspected, ${s.cases.deaths} deaths`)
  }
  const top = [...s.signals].sort((a, b) => b.norm - a.norm).slice(0, 3)
  if (top.length > 0) {
    lines.push(`Strongest signals: ${top.map(t => `${t.label} ${Math.round(t.norm * 100)}%`).join(', ')}`)
  }
  lines.push('_Heuristic composite of news, WHO, Russian official statements, search and social signals._')
  return lines.join('\n')
}

/** `██████░░░░` for a 0..1 value. */
export function bar(norm: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(norm * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
