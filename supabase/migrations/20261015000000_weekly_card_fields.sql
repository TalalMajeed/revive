-- Fields the weekly card, cause log and replay need beyond the core schema.

-- Where the schedule starts (offset 0 of the baseline) and the status date
-- of the file as imported, before any weekly update.
alter table public.projects
  add column location text,
  add column schedule_start date,
  add column import_data_date date;

-- As-planned dates from the baseline critical path, and the trade, used to
-- price speed-ups and word the reasons.
alter table public.activities
  add column baseline_start date,
  add column baseline_finish date,
  add column trade text,
  add constraint activities_baseline_order
    check (baseline_start is null or baseline_finish is null or baseline_finish >= baseline_start);

-- Open issues (RFIs, VOs, utility shifting) stay open until resolved; open
-- design issues widen the forecast and feed the reasons.
alter table public.weekly_events
  add column resolved_on date,
  add constraint weekly_events_resolved_after_raised
    check (resolved_on is null or resolved_on >= event_date);

-- Recovery plans record whether they meet the target.
alter table public.recovery_plans
  add column meets_target boolean;
