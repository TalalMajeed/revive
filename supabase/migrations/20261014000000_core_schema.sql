-- Revive core schema.
--
-- Every company is a private workspace. Each table carries company_id, and
-- row-level security limits every row to members of that company. Child
-- tables use composite foreign keys (project_id, company_id) so a row can
-- never point at a project from another company.
--
-- Roles inside a company:
--   owner, admin  manage the company and its members
--   member        reads and writes project data
--   viewer        reads only

create extension if not exists pgcrypto;

-- Helpers live in a schema the Data API does not expose.
create schema if not exists private;

-------------------------------------------------------------------------------
-- Companies, profiles, memberships
-------------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per auth user, created by a trigger on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-------------------------------------------------------------------------------
-- Security helpers
--
-- security definer so policies on memberships don't recurse into themselves.
-------------------------------------------------------------------------------

create function private.user_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select company_id from public.memberships where user_id = (select auth.uid())
$$;

create function private.has_company_role(target_company uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where company_id = target_company
      and user_id = (select auth.uid())
      and role = any (roles)
  )
$$;

create function private.can_write(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_role(target_company, array['owner', 'admin', 'member'])
$$;

create function private.can_manage(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_role(target_company, array['owner', 'admin'])
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- A signed-in user creates a company and becomes its owner in one step.
-- Direct inserts into companies are not allowed by policy.
create function public.create_company(company_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  insert into public.companies (name) values (company_name) returning id into new_id;
  insert into public.memberships (company_id, user_id, role)
  values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;

revoke execute on function public.create_company(text) from public, anon;
grant execute on function public.create_company(text) to authenticated;

-------------------------------------------------------------------------------
-- Projects
--
-- The 12 setup answers are the award-time signals the first model uses.
-- They are entered once in the setup wizard.
-------------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  code text,
  status text not null default 'active'
    check (status in ('setup', 'active', 'completed', 'archived')),

  -- Setup answers
  -- 1. What is being built
  project_type text
    check (project_type in ('building', 'road', 'bridge', 'water_sanitation',
                            'irrigation', 'power', 'other')),
  -- 2. Who the client is
  client_type text
    check (client_type in ('federal_government', 'provincial_government',
                           'local_government', 'autonomous_body', 'donor',
                           'private')),
  -- 3. Where the money comes from
  funding_source text
    check (funding_source in ('psdp', 'adp', 'foreign_aid', 'own_funds',
                              'private', 'mixed')),
  -- 4. Share of the contract value already allocated or released
  funding_secured_pct numeric(5, 2) check (funding_secured_pct between 0 and 100),
  -- 5. Contract value
  contract_value_pkr numeric(16, 2) check (contract_value_pkr >= 0),
  -- 6. Engineer's estimate, for bid vs estimate
  engineers_estimate_pkr numeric(16, 2) check (engineers_estimate_pkr >= 0),
  -- 7. Number of bids received
  bidders_count integer check (bidders_count >= 0),
  -- 8. Contract start (commencement) date
  contract_start_date date,
  -- 9. Original contract completion date, the date delay is measured against
  original_completion_date date,
  -- 10. Contractor's PEC licence category
  pec_category text check (pec_category in ('CA', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6')),
  -- 11. How complete the design was at award
  design_status_at_award text
    check (design_status_at_award in ('complete', 'partial', 'concept')),
  -- 12. Province or territory
  province text
    check (province in ('punjab', 'sindh', 'kp', 'balochistan', 'ict', 'gb', 'ajk')),

  -- Schedule and outcome
  schedule_source text check (schedule_source in ('xer', 'mspdi', 'excel', 'manual')),
  -- Working days, 0 = Sunday .. 6 = Saturday. Default Monday to Saturday.
  working_weekdays smallint[] not null default '{1,2,3,4,5,6}',
  data_date date,
  actual_completion_date date,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, company_id),
  check (original_completion_date is null or contract_start_date is null
         or original_completion_date >= contract_start_date)
);

create index projects_company_id_idx on public.projects (company_id);

-------------------------------------------------------------------------------
-- Schedule: activities and dependencies
-------------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  -- Activity ID from the source schedule (P6 task_code, MS Project UID).
  external_id text not null,
  name text not null,
  wbs text,
  is_milestone boolean not null default false,
  original_duration_days numeric(10, 2) not null default 0
    check (original_duration_days >= 0),
  remaining_duration_days numeric(10, 2) not null default 0
    check (remaining_duration_days >= 0),
  -- Triangular range for the simulation; null means use the default spread.
  duration_min_days numeric(10, 2) check (duration_min_days >= 0),
  duration_max_days numeric(10, 2) check (duration_max_days >= 0),
  percent_complete numeric(5, 2) not null default 0
    check (percent_complete between 0 and 100),
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  unique (project_id, external_id),
  unique (id, project_id),
  check (duration_min_days is null or duration_max_days is null
         or duration_min_days <= duration_max_days)
);

create index activities_company_id_idx on public.activities (company_id);

create table public.dependencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  predecessor_id uuid not null,
  successor_id uuid not null,
  link_type text not null default 'FS' check (link_type in ('FS', 'SS', 'FF', 'SF')),
  lag_days numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  -- Both ends must be activities of the same project.
  foreign key (predecessor_id, project_id)
    references public.activities (id, project_id) on delete cascade,
  foreign key (successor_id, project_id)
    references public.activities (id, project_id) on delete cascade,
  unique (predecessor_id, successor_id, link_type),
  check (predecessor_id <> successor_id)
);

create index dependencies_project_id_idx on public.dependencies (project_id);
create index dependencies_company_id_idx on public.dependencies (company_id);
create index dependencies_successor_id_idx on public.dependencies (successor_id, project_id);

-------------------------------------------------------------------------------
-- Weekly progress
-------------------------------------------------------------------------------

-- The 2-minute weekly form. One per project per week.
create table public.progress_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  -- Monday of the reporting week.
  week_start date not null check (extract(isodow from week_start) = 1),
  data_date date not null,
  overall_percent_complete numeric(5, 2)
    check (overall_percent_complete between 0 and 100),
  notes text,
  submitted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  unique (project_id, week_start),
  unique (id, project_id)
);

create index progress_updates_company_id_idx on public.progress_updates (company_id);

-- Per-activity progress reported in a weekly update.
create table public.activity_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  update_id uuid not null,
  activity_id uuid not null,
  percent_complete numeric(5, 2) not null check (percent_complete between 0 and 100),
  remaining_duration_days numeric(10, 2) check (remaining_duration_days >= 0),
  actual_start date,
  actual_finish date,
  created_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (update_id, project_id)
    references public.progress_updates (id, project_id) on delete cascade,
  foreign key (activity_id, project_id)
    references public.activities (id, project_id) on delete cascade,
  unique (update_id, activity_id)
);

create index activity_progress_company_id_idx on public.activity_progress (company_id);
create index activity_progress_activity_id_idx on public.activity_progress (activity_id, project_id);

-------------------------------------------------------------------------------
-- Payments (interim payment certificates)
-------------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  ipc_number integer not null check (ipc_number > 0),
  amount_claimed_pkr numeric(16, 2) check (amount_claimed_pkr >= 0),
  submitted_on date,
  amount_certified_pkr numeric(16, 2) check (amount_certified_pkr >= 0),
  certified_on date,
  -- Contractual payment due date, for payment-delay days.
  due_on date,
  amount_paid_pkr numeric(16, 2) check (amount_paid_pkr >= 0),
  paid_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  unique (project_id, ipc_number),
  check (certified_on is null or submitted_on is null or certified_on >= submitted_on),
  check (paid_on is null or certified_on is null or paid_on >= certified_on)
);

create index payments_company_id_idx on public.payments (company_id);

-------------------------------------------------------------------------------
-- Events and slip reasons: the dated cause log behind the EOT evidence pack
-------------------------------------------------------------------------------

create table public.weekly_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  update_id uuid,
  activity_id uuid,
  event_date date not null,
  category text not null
    check (category in ('design_query', 'drawing_delay', 'variation_order',
                        'payment_delay', 'site_access', 'material_shortage',
                        'crew_shortage', 'equipment_breakdown', 'weather',
                        'utility_shifting', 'law_and_order', 'other')),
  -- Who caused it, and so who can fix it.
  responsible_party text not null
    check (responsible_party in ('client', 'consultant', 'contractor',
                                 'subcontractor', 'supplier', 'authority',
                                 'none')),
  description text not null,
  days_lost numeric(6, 2) check (days_lost >= 0),
  reference text, -- letter or RFI number, for the evidence pack
  reported_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (update_id, project_id)
    references public.progress_updates (id, project_id) on delete set null (update_id),
  foreign key (activity_id, project_id)
    references public.activities (id, project_id) on delete set null (activity_id)
);

create index weekly_events_project_date_idx on public.weekly_events (project_id, event_date);
create index weekly_events_company_id_idx on public.weekly_events (company_id);

-- Why an activity slipped this week, picked in the weekly form.
create table public.slip_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  update_id uuid not null,
  activity_id uuid,
  category text not null
    check (category in ('design_query', 'drawing_delay', 'variation_order',
                        'payment_delay', 'site_access', 'material_shortage',
                        'crew_shortage', 'equipment_breakdown', 'weather',
                        'utility_shifting', 'law_and_order', 'other')),
  responsible_party text not null
    check (responsible_party in ('client', 'consultant', 'contractor',
                                 'subcontractor', 'supplier', 'authority',
                                 'none')),
  days_slipped numeric(6, 2) check (days_slipped >= 0),
  note text,
  created_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (update_id, project_id)
    references public.progress_updates (id, project_id) on delete cascade,
  foreign key (activity_id, project_id)
    references public.activities (id, project_id) on delete set null (activity_id)
);

create index slip_reasons_update_id_idx on public.slip_reasons (update_id);
create index slip_reasons_company_id_idx on public.slip_reasons (company_id);

-------------------------------------------------------------------------------
-- Forecasts: one row per project per week per method, never edited
-------------------------------------------------------------------------------

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  update_id uuid,
  as_of date not null,
  method text not null check (method in ('simulation', 'ebm', 'blend')),
  model_version text,
  -- The date "late" is measured against, usually the original completion date.
  target_date date not null,
  probability_late numeric(5, 4) not null check (probability_late between 0 and 1),
  deterministic_finish date,
  p10_finish date,
  p50_finish date,
  p90_finish date,
  iterations integer check (iterations > 0),
  health_score numeric(5, 2) check (health_score between 0 and 100),
  -- Marked "learning" until the model is validated on held-out projects.
  is_learning boolean not null default true,
  -- Top reasons: [{ "signal", "contribution", "owner", "text" }]
  reasons jsonb not null default '[]' check (jsonb_typeof(reasons) = 'array'),
  -- Activity id -> share of runs on the critical path.
  criticality jsonb not null default '{}' check (jsonb_typeof(criticality) = 'object'),
  -- Inputs as used, so any forecast can be reproduced.
  inputs jsonb not null default '{}' check (jsonb_typeof(inputs) = 'object'),
  created_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (update_id, project_id)
    references public.progress_updates (id, project_id) on delete set null (update_id),
  unique (id, project_id),
  check (p10_finish is null or p50_finish is null or p10_finish <= p50_finish),
  check (p50_finish is null or p90_finish is null or p50_finish <= p90_finish)
);

create index forecasts_project_as_of_idx on public.forecasts (project_id, as_of desc);
create index forecasts_company_id_idx on public.forecasts (company_id);

-------------------------------------------------------------------------------
-- Recovery plans
-------------------------------------------------------------------------------

create table public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  project_id uuid not null,
  forecast_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'accepted', 'rejected')),
  budget_pkr numeric(16, 2) check (budget_pkr >= 0),
  target_finish date,
  new_finish date,
  total_cost_pkr numeric(16, 2) check (total_cost_pkr >= 0),
  -- [{ "activity_id", "option", "days_saved", "cost_pkr" }]
  actions jsonb not null default '[]' check (jsonb_typeof(actions) = 'array'),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, company_id)
    references public.projects (id, company_id) on delete cascade,
  foreign key (forecast_id, project_id)
    references public.forecasts (id, project_id) on delete set null (forecast_id)
);

create index recovery_plans_project_id_idx on public.recovery_plans (project_id);
create index recovery_plans_company_id_idx on public.recovery_plans (company_id);

-------------------------------------------------------------------------------
-- updated_at triggers
-------------------------------------------------------------------------------

create trigger set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.activities
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.progress_updates
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.payments
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.weekly_events
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.recovery_plans
  for each row execute function private.set_updated_at();

-------------------------------------------------------------------------------
-- Row-level security
-------------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.activities enable row level security;
alter table public.dependencies enable row level security;
alter table public.progress_updates enable row level security;
alter table public.activity_progress enable row level security;
alter table public.payments enable row level security;
alter table public.weekly_events enable row level security;
alter table public.slip_reasons enable row level security;
alter table public.forecasts enable row level security;
alter table public.recovery_plans enable row level security;

-- companies: members read; owners and admins rename. Created via create_company().
create policy "members read their companies" on public.companies
  for select to authenticated
  using (id in (select private.user_company_ids()));

create policy "managers update their companies" on public.companies
  for update to authenticated
  using (private.can_manage(id))
  with check (private.can_manage(id));

-- profiles: your own, and those of people in your companies.
create policy "read own and teammates' profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select user_id from public.memberships
      where company_id in (select private.user_company_ids())
    )
  );

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- memberships: members see the team; owners and admins manage it.
create policy "members read memberships" on public.memberships
  for select to authenticated
  using (company_id in (select private.user_company_ids()));

create policy "managers add members" on public.memberships
  for insert to authenticated
  with check (private.can_manage(company_id));

create policy "managers change members" on public.memberships
  for update to authenticated
  using (private.can_manage(company_id))
  with check (private.can_manage(company_id));

create policy "managers remove members, anyone leaves" on public.memberships
  for delete to authenticated
  using (private.can_manage(company_id) or user_id = (select auth.uid()));

-- Project data: every member reads, writers write. Same four policies on
-- each table; forecasts are append-only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'activities', 'dependencies', 'progress_updates',
    'activity_progress', 'payments', 'weekly_events', 'slip_reasons',
    'forecasts', 'recovery_plans'
  ] loop
    execute format(
      'create policy "members read" on public.%I for select to authenticated
         using (company_id in (select private.user_company_ids()))', t);
    execute format(
      'create policy "writers insert" on public.%I for insert to authenticated
         with check (private.can_write(company_id))', t);
    if t <> 'forecasts' then
      execute format(
        'create policy "writers update" on public.%I for update to authenticated
           using (private.can_write(company_id))
           with check (private.can_write(company_id))', t);
      -- Deleting a whole project takes everything under it, so only
      -- owners and admins may do it.
      execute format(
        'create policy "writers delete" on public.%I for delete to authenticated
           using (private.%s(company_id))',
        t, case when t = 'projects' then 'can_manage' else 'can_write' end);
    end if;
  end loop;
end;
$$;

-- Forecasts are a log: no updates or deletes, even through the API.
revoke update, delete on public.forecasts from anon, authenticated;
