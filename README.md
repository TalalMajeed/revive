# Revive

Early warning for construction delays, for contractors in Pakistan. Every
Monday it tells a planning engineer which project is slipping, why, and what
to do this week.

One Next.js app (App Router, TypeScript) on Vercel, with Supabase for
Postgres, auth and storage. No paid APIs and no LLMs in production.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | Pages and route handlers. `app/auth/callback` finishes Supabase sign-in. |
| `proxy.ts`, `lib/supabase/` | Supabase clients and the session refresh that runs on each request. Both do nothing until the env vars are set. |
| `supabase/migrations/` | Core schema with row-level security per company. |
| `lib/schedule/` | P6 XER and MS Project XML import, working-day calendar, critical-path engine. |
| `lib/forecast/simulate.ts` | Monte Carlo forecast: chance of finishing late, P10/P50/P90 finish dates, criticality. |
| `training/` | Offline EBM training in Python, run monthly by `.github/workflows/train-model.yml`. |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in from the Supabase dashboard
npm run dev
```

```bash
npm test          # vitest
npm run typecheck
npm run lint
npm run build
```

Apply the schema with the Supabase CLI (`supabase db push`) or by pasting
the migration into the SQL editor.

## Schedule maths

Durations and lags are in working days from the data date. The engine handles
FS, SS, FF and SF links with lags and leads, and reports early and late dates,
total and free float, and the critical path. `lib/schedule/calendar.ts` turns
offsets into dates on a six-day week (Monday to Saturday) by default.

The simulation draws each remaining activity's duration from a triangular
range: per activity if given, otherwise 0.9 to 1.3 times the remaining
duration. That default is a placeholder until it is calibrated on finished
projects.
