export type PlagueBand = 'low' | 'elevated' | 'high' | 'severe'

export type PlagueSignal = { key: string; label: string; value: number; norm: number }

export type PlagueSummary = {
  /** Threat level 0-100. */
  level: number
  band: PlagueBand
  /** Level now minus level 24h ago; null when the tracker has no point that old. */
  delta24h: number | null
  /** Threat level series, oldest first, last point = now. */
  spark: number[]
  /** What `spark` spans: hourly over 24h (/api/summary) or daily over 14d (/api/signals fallback). */
  sparkSpan: '24h' | '14d'
  signals: PlagueSignal[]
  cases: { confirmed: number; suspected: number; deaths: number } | null
  /** The tracker's web page. */
  url: string
  /** When the tracker computed it (ISO). */
  ts: string
}

declare module 'claude-code' {
  interface PluginState {
    'plague-tracker': {
      summary: PlagueSummary | null
      error: string | null
      isOn: boolean
    }
  }
}
