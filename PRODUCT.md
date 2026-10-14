# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Planning engineers and project managers at Pakistani construction contractors.
The planning engineer updates progress once a week (often from site, on a
phone) and reads the Monday card at a desk; the manager scans every project
at once. For the current milestone the audience is also a university
professor evaluating the final-year project as it becomes a product.

## Product Purpose

Revive is an early warning for construction delays. Every Monday it says
which project is slipping, why, and what to do this week. It must be useful
before any model is accurate, otherwise site teams stop sending updates and
the data never builds up.

## Positioning

Forecasts come from the contractor's own schedule (P6 XER or MS Project XML)
run through a critical path and a 2,000-run Monte Carlo simulation, with an
explainable model (EBM) layered on as it proves itself. The reasons given are
exact contributions, each with an owner. The 2-minute weekly update doubles
as a dated cause log that becomes an extension-of-time (EOT) evidence pack,
which is the hook for contractors who lose delay disputes for lack of
records.

## Operating Context

- Weekly rhythm: update on Friday/Monday, card read on Monday.
- Inputs: setup once (12 answers + schedule file), weekly progress %, IPC
  payment dates (certified, paid), events and slip reasons with who caused
  them, and a recovery request (budget, target date) when wanted.
- Outputs: weekly card (health score, chance of delay, P10–P90 range, top
  reasons with owners, recovery plan), portfolio ranked by risk, EOT
  evidence pack, replay of finished projects.
- Six-day site week (Monday to Saturday). Money in PKR.

## Capabilities and Constraints

- One Next.js app on Vercel's free tier; Supabase for Postgres/auth later.
  Until a Supabase project exists, data lives in the browser with seeded
  demo projects.
- No paid APIs, no LLMs in production; reasons are written from templates.
- Predictions are marked "learning" until the in-project model is validated
  on at least 30 held-out projects. The award-risk model shipped now is a
  demo trained on synthetic data and must say so.
- Later, not now: 3D BIM view, WhatsApp reminders, Urdu interface,
  client/consultant portals, native app.

## Evidence on Hand

- Sample schedules: lib/schedule/__fixtures__/sample.xer, sample.xml.
- No real customer data, testimonials or accuracy record exist yet. Demo
  projects are illustrative and must be labelled as such.

## Product Principles

1. Honest before clever: show uncertainty as a range and label anything
   unvalidated.
2. Every warning names an owner and an action.
3. The weekly update must fit in two minutes on a phone.
4. Records are evidence: dated, attributable, exportable.
