# plague-tracker: Claude Code mod

Shows the plague outbreak threat level from the
[plague tracker](https://plague-tracker-theta.vercel.app/) inside Claude Code.

```
☣ Plague threat 57.7/100 high ▼ -3.6/24h ▁▁▁▁▁▁▃▅▄▆▇███ [web]
```

## Commands

| Command | What it does |
| --- | --- |
| `/plague-tracker` | Prints the current threat level, its 24h change, a sparkline, case totals, the strongest signals and a `[web]` link |
| `/plague-tracker on` | Keeps the threat level on screen: a band above the prompt with a `[web]` link (or the status line, see `display`), refreshed every 30 minutes by default. On by default after install; stays as you left it in later sessions |
| `/plague-tracker off` | Removes it and stops polling, in later sessions too |
| `/plague-tracker pane` | Opens a pane with every signal as a bar, case totals, when it was computed, `[web]` and a Refresh button |

## Install

At a Claude Code prompt:

```
/plugin install plague-tracker --marketplace fanick1/claude-code-plague-tracker-mod
```

Answer `y` to add the marketplace, then pick a scope.

From a clone, for one session:

```sh
claude --plugin-dir ~/git/claude-code-plague-tracker-mod
```

Or permanently, with this folder as a local marketplace:

```sh
claude plugin marketplace add ~/git/claude-code-plague-tracker-mod
claude plugin install plague-tracker@plague-tracker
```

## Options (`/config`)

| Option | Default | |
| --- | --- | --- |
| `display` | `band` | `band`: a row above the prompt with a clickable `[web]`; `status`: one plain line in the status area |
| `refreshMinutes` | `30` | refetch interval while on |

## Data source

The mod reads `GET /api/summary` (level, band, 24h change, hourly series for the
last 24h, signals and case totals). On a deployment without that endpoint it falls back to
`GET /api/signals` and works out the same values from the daily history. In that case the
sparkline covers 14 days.

The threat level is a heuristic composite; see the tracker for how it is computed.

## Development

```sh
claude plugin validate .
claude plugin test .
```
