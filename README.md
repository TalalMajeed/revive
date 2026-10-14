# Revive

Early warning for construction delays, for contractors in Pakistan. Every
Monday it tells a planning engineer which project is slipping, why, and what
to do this week.

One Next.js app (App Router, TypeScript) on Vercel, with Supabase for
Postgres, auth and storage. No paid APIs and no LLMs in production.

## Demo

```bash
npm install
npm run build && npm start   # http://localhost:3000
```

Click **Load demo projects** on the home page. It builds three illustrative
projects in the browser, with a weekly history behind each:

- **Hasilpur–Chishtian road**, live and slipping: utility shifting at the
  culverts, unpaid IPCs, monsoon, an open RFI. Open it for the weekly card.
- **Family clinic, Lahore**, live and on track.
- **Girls school, Shujabad**, finished late. Open **Replay** to step through
  it week by week and see that Revive warned 16 weeks before the contract
  completion date.

Each project has these tabs:

- **Weekly card**: health, chance of finishing late, P10–P90 finish range,
  reasons with owners and this week's action, what drives the finish,
  forecast log, and award-time risk from the EBM.
- **Schedule**: Gantt with the critical path, S-curve and earned schedule.
- **Weekly update**: the phone form.
- **Causes and payments**: the dated cause log and IPC delays.
- **Recovery**: the cheapest speed-up plan, solved by HiGHS on the server.
- **EOT pack**: a printable evidence pack.
- **Replay**: the project week by week.

**Set up a project** runs the 12-question wizard and accepts a P6 `.xer` or
MS Project `.xml` file, or the bundled sample.

Data is saved in the browser (localStorage) until a Supabase project is
connected, so each browser has its own projects. The demo projects and the
award-risk model, which is trained on synthetic data, are labelled as such
in the app.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | Pages and route handlers. `app/auth/callback` finishes Supabase sign-in. |
| `proxy.ts`, `lib/supabase/` | Supabase clients and the session refresh that runs on each request. Both do nothing until the env vars are set. |
| `supabase/migrations/` | Core schema with row-level security per company. `supabase/tests/` checks it. |
| `lib/schedule/` | P6 XER and MS Project XML import, working-day calendar, critical-path engine. |
| `lib/forecast/simulate.ts` | Monte Carlo forecast: chance of finishing late, P10/P50/P90 finish dates, criticality. |
| `lib/forecast/ebm.ts`, `award.ts` | EBM evaluator for interpret's `to_json()` export, and the award-time risk model (demo, synthetic). |
| `lib/progress/` | The weekly check: replaying progress to any week, earned schedule, warning signs, rule-based reasons with owners, health score, EOT evidence. |
| `lib/recovery/`, `app/api/recovery` | Time–cost trade-off as a linear programme, solved with HiGHS (WebAssembly). |
| `lib/data/` | Record types matching the schema, and the browser store that stands in for Supabase. |
| `lib/demo/` | Builds the demo projects by simulating each site day by day. |
| `app/projects/` | The screens; `components/` holds the shared UI and SVG charts. |
| `training/` | Offline EBM training in Python, run monthly by `.github/workflows/train-model.yml`. |
| `scripts/` | `forecast.ts` (schedule file to forecast) and `test-db.sh` (database checks). |

## Running it locally

Needs Node 20+. Postgres and Python are only needed for the database checks
and training.

```bash
npm install
npm run dev                # http://localhost:3000
```

The app runs without Supabase: auth stays switched off until
`.env.local` has the keys (copy `.env.example`, fill in from the Supabase
dashboard under Project Settings > API, then restart `npm run dev`).

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the importers, critical path and simulation |
| `npm run forecast -- <file>` | Imports a P6 `.xer` or MS Project `.xml` file and prints the critical path and forecast |
| `npm run test:db` | Applies the migrations to a throwaway Postgres and runs the row-level security checks |
| `npm run typecheck`, `npm run lint`, `npm run build` | The checks Vercel's build runs |

### Forecast a schedule

```bash
npm run forecast -- lib/schedule/__fixtures__/sample.xer
npm run forecast -- my-project.xer --target 2027-06-30 --data-date 2026-10-14
```

Options: `--target` (date that counts as late; defaults to the file's
planned finish), `--data-date` (defaults to the file's status date),
`--iterations` (default 2000), `--seed` (repeatable runs), `--project`
(P6 project id or short name when the XER holds several), `--json`.
MS Project users save the plan as XML first (File > Save As > XML).

### Database

`npm run test:db` needs Postgres 15+ installed (`brew install
postgresql@17`) and nothing else. To put the schema on Supabase, run
`supabase db push` with the Supabase CLI, or paste
`supabase/migrations/*.sql` into the SQL editor.

### Training

See [training/README.md](training/README.md).

## Schedule maths

Durations and lags are in working days from the data date. The engine handles
FS, SS, FF and SF links with lags and leads, and reports early and late dates,
total and free float, and the critical path. `lib/schedule/calendar.ts` turns
offsets into dates on a six-day week (Monday to Saturday) by default.

The simulation draws each remaining activity's duration from a triangular
range: per activity if given, otherwise 0.9 to 1.3 times the remaining
duration. That default is a placeholder until it is calibrated on finished
projects.
