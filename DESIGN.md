# Design

## World: site-office instrument

A planning tool pinned to the wall of a site office: warm drafting paper,
ink, ruled lines, and one signal colour reserved for risk. Calm and dense.
It should read as a serious engineering instrument, not a marketing
dashboard. Light theme only: it is used in daylight offices and on site.

## Tokens (app/globals.css)

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | #f5f1e8 | page background |
| `--panel` | #ece6d8 | second neutral layer: header, table heads, inset panels |
| `--sheet` | #fbf9f4 | raised sheets (forms, the card) |
| `--ink` | #1d1c19 | text, primary actions, critical-path bars |
| `--ink-2` | #57524a | secondary text (≥4.5:1 on paper) |
| `--rule` | #d6cfbf | hairlines, table rules, grid |
| `--risk` | #c2410c | safety orange: late, critical, risk; never decoration |
| `--warn` | #a16207 | at risk |
| `--ok` | #3d6b4f | on track |
| `--plan` | #8a8272 | baseline / planned series |

Health bands: ≥70 on track (ok), 40–69 at risk (warn), <40 critical (risk).

## Type

IBM Plex Sans (self-hosted via next/font) for everything; IBM Plex Mono
only for activity codes, IPC numbers and dates in tables. Fixed rem scale,
ratio ~1.2. All numbers use tabular figures. Headings 600, body 400.

## Shape and depth

Square-ish: 4px radius on controls, 6px on sheets. Separation by hairline
rules and the paper/panel step, not shadows. One shadow only, for the
sticky header: 0 1px 0 var(--rule).

## Charts

Hand-drawn SVG, ink on paper. Baseline in `--plan` dashed, actual/forecast
in ink, risk in `--risk`. Gridlines are `--rule` hairlines. Labels set
directly on the chart instead of legends where possible.

## Icons

lucide-react, 1.75 stroke, 16–18px.

## Motion

150–200ms ease-out on state changes only. No page-load choreography.
