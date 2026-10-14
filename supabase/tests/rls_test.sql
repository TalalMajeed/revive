-- Row-level security checks. Any failed check raises and stops the run.
\set ON_ERROR_STOP on
\set QUIET on

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-00000000000c', '{"full_name":"Vera"}');
select pg_temp.check((select count(*) from public.profiles) = 3, 'sign-up creates a profile');

set role authenticated;

-- Alice owns company A, Bob owns company B.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.create_company('Alpha Builders') as a_id \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.create_company('Beta Constructors') as b_id \gset
select set_config('test.b_id', :'b_id', false) \gset

do $$ begin
  insert into public.companies (name) values ('sneaky');
  raise exception 'FAIL: direct company insert allowed';
exception when insufficient_privilege then raise notice 'ok: companies are only created through create_company()';
end $$;

-- Bob fills in a project.
insert into public.projects (company_id, name, contract_start_date, original_completion_date)
  values (:'b_id', 'Beta road', '2026-01-01', '2027-06-30') returning id as bp \gset
insert into public.activities (company_id, project_id, external_id, name, original_duration_days, remaining_duration_days)
  values (:'b_id', :'bp', 'A100', 'Excavation', 10, 10) returning id as act1 \gset
insert into public.activities (company_id, project_id, external_id, name, original_duration_days, remaining_duration_days)
  values (:'b_id', :'bp', 'A110', 'Sub-base', 5, 5) returning id as act2 \gset
insert into public.dependencies (company_id, project_id, predecessor_id, successor_id, link_type, lag_days)
  values (:'b_id', :'bp', :'act1', :'act2', 'SS', 2);
insert into public.progress_updates (company_id, project_id, week_start, data_date)
  values (:'b_id', :'bp', '2026-10-12', '2026-10-14') returning id as upd \gset
insert into public.activity_progress (company_id, project_id, update_id, activity_id, percent_complete)
  values (:'b_id', :'bp', :'upd', :'act1', 40);
insert into public.payments (company_id, project_id, ipc_number, certified_on, paid_on)
  values (:'b_id', :'bp', 1, '2026-09-01', '2026-10-10');
insert into public.weekly_events (company_id, project_id, update_id, event_date, category, responsible_party, description)
  values (:'b_id', :'bp', :'upd', '2026-10-13', 'design_query', 'consultant', 'RFI-12 unanswered');
insert into public.slip_reasons (company_id, project_id, update_id, activity_id, category, responsible_party)
  values (:'b_id', :'bp', :'upd', :'act1', 'crew_shortage', 'contractor');
insert into public.forecasts (company_id, project_id, as_of, method, target_date, probability_late, p10_finish, p50_finish, p90_finish)
  values (:'b_id', :'bp', '2026-10-14', 'simulation', '2027-06-30', 0.42, '2027-05-01', '2027-06-20', '2027-08-15')
  returning id as fc \gset
insert into public.recovery_plans (company_id, project_id, forecast_id, budget_pkr) values (:'b_id', :'bp', :'fc', 1000000);
select pg_temp.check((select count(*) from public.projects) = 1, 'owner writes project data');

do $$ begin
  update public.forecasts set probability_late = 0.1;
  raise exception 'FAIL: forecast update allowed';
exception when insufficient_privilege then raise notice 'ok: forecasts are append-only';
end $$;

-- Alice sees none of it and cannot write into company B.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check(
  (select count(*) from public.companies) = 1
  and (select count(*) from public.projects) = 0
  and (select count(*) from public.activities) = 0
  and (select count(*) from public.dependencies) = 0
  and (select count(*) from public.progress_updates) = 0
  and (select count(*) from public.activity_progress) = 0
  and (select count(*) from public.payments) = 0
  and (select count(*) from public.weekly_events) = 0
  and (select count(*) from public.slip_reasons) = 0
  and (select count(*) from public.forecasts) = 0
  and (select count(*) from public.recovery_plans) = 0
  and (select count(*) from public.profiles) = 1,
  'another company sees nothing');

do $$ begin
  insert into public.projects (company_id, name) values (current_setting('test.b_id')::uuid, 'hijack');
  raise exception 'FAIL: cross-company insert allowed';
exception when insufficient_privilege then raise notice 'ok: cannot insert into another company';
end $$;

with changed as (update public.projects set name = 'hacked' returning 1)
select pg_temp.check((select count(*) from changed) = 0, 'cannot update another company''s rows');

insert into public.projects (company_id, name) values (:'a_id', 'Alpha tower') returning id as ap \gset
do $$ begin
  insert into public.activities (company_id, project_id, external_id, name)
    values (current_setting('test.b_id')::uuid, (select id from public.projects limit 1), 'X', 'x');
  raise exception 'FAIL: mismatched company and project allowed';
exception when insufficient_privilege or foreign_key_violation then
  raise notice 'ok: a row cannot pair one company with another company''s project';
end $$;

-- Bob adds Vera as a viewer: she reads but cannot write.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.memberships (company_id, user_id, role)
  values (:'b_id', '00000000-0000-0000-0000-00000000000c', 'viewer');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from public.projects) = 1, 'viewer reads the project');
do $$ begin
  insert into public.payments (company_id, project_id, ipc_number)
    select company_id, id, 2 from public.projects limit 1;
  raise exception 'FAIL: viewer insert allowed';
exception when insufficient_privilege then raise notice 'ok: viewer cannot insert';
end $$;
with changed as (update public.activities set name = 'viewer edit' returning 1)
select pg_temp.check((select count(*) from changed) = 0, 'viewer cannot update');

-- Signed-out requests see nothing.
reset role;
set role anon;
select pg_temp.check((select count(*) from public.projects) = 0, 'anon sees nothing');
reset role;
