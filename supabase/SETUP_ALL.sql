-- ============================================================
-- busungtk-overtime 전체 DB 셋업 (합본)
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요
-- ============================================================

-- === Migration #1: 초기 스키마 (8 테이블 + RLS) ===

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists employees (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  avatar_url    text,
  department    text not null default '',
  role          text not null default 'employee' check (role in ('employee','manager','admin')),
  employee_type text not null default 'office' check (employee_type in ('office','field')),
  hourly_wage   integer not null default 0,
  manager_id    uuid references employees(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger employees_updated_at
  before update on employees
  for each row execute function update_updated_at_column();

create table if not exists overtime_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete cascade,
  type             text not null check (type in ('extended','night','holiday')),
  date             date not null,
  planned_start    time not null,
  planned_end      time not null,
  reason           text not null default '',
  status           text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  is_retroactive   boolean not null default false,
  group_id         uuid,
  created_by       uuid not null references employees(id),
  approved_by      uuid references employees(id),
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_overtime_requests_employee_id on overtime_requests(employee_id);
create index if not exists idx_overtime_requests_date        on overtime_requests(date);
create index if not exists idx_overtime_requests_status      on overtime_requests(status);
create index if not exists idx_overtime_requests_group_id    on overtime_requests(group_id);

create trigger overtime_requests_updated_at
  before update on overtime_requests
  for each row execute function update_updated_at_column();

create table if not exists time_records (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references overtime_requests(id) on delete cascade,
  employee_id        uuid not null references employees(id) on delete cascade,
  actual_start       timestamptz,
  actual_end         timestamptz,
  total_minutes      integer not null default 0,
  extended_minutes   integer not null default 0,
  night_minutes      integer not null default 0,
  holiday_minutes    integer not null default 0,
  is_manually_edited boolean not null default false,
  edit_reason        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_time_records_employee_id on time_records(employee_id);
create index if not exists idx_time_records_request_id  on time_records(request_id);

create trigger time_records_updated_at
  before update on time_records
  for each row execute function update_updated_at_column();

create table if not exists weekly_summaries (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  week_start    date not null,
  base_hours    numeric(5,2) not null default 0,
  overtime_hours numeric(5,2) not null default 0,
  total_hours   numeric(5,2) not null default 0,
  warning_level text not null default 'normal' check (warning_level in ('normal','caution','warning','exceeded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (employee_id, week_start)
);

create index if not exists idx_weekly_summaries_employee_id on weekly_summaries(employee_id);
create index if not exists idx_weekly_summaries_week_start  on weekly_summaries(week_start);

create trigger weekly_summaries_updated_at
  before update on weekly_summaries
  for each row execute function update_updated_at_column();

create table if not exists leave_balances (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  year            integer not null,
  total_days      numeric(4,1) not null default 0,
  used_days       numeric(4,1) not null default 0,
  remaining_days  numeric(4,1) generated always as (total_days - used_days) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, year)
);

create index if not exists idx_leave_balances_employee_id on leave_balances(employee_id);

create trigger leave_balances_updated_at
  before update on leave_balances
  for each row execute function update_updated_at_column();

create table if not exists leave_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete cascade,
  type             text not null check (type in ('annual','half_am','half_pm','special','sick')),
  start_date       date not null,
  end_date         date not null,
  days             numeric(4,1) not null,
  reason           text not null default '',
  status           text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approved_by      uuid references employees(id),
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_leave_requests_employee_id on leave_requests(employee_id);
create index if not exists idx_leave_requests_status      on leave_requests(status);
create index if not exists idx_leave_requests_start_date  on leave_requests(start_date);

create trigger leave_requests_updated_at
  before update on leave_requests
  for each row execute function update_updated_at_column();

create table if not exists ot_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references employees(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text not null default '',
  reference_id uuid,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ot_notifications_recipient_id on ot_notifications(recipient_id);
create index if not exists idx_ot_notifications_is_read      on ot_notifications(recipient_id, is_read);

create table if not exists ot_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references employees(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ot_audit_logs_actor_id    on ot_audit_logs(actor_id);
create index if not exists idx_ot_audit_logs_target_id   on ot_audit_logs(target_id);
create index if not exists idx_ot_audit_logs_created_at  on ot_audit_logs(created_at desc);

alter table employees         enable row level security;
alter table overtime_requests enable row level security;
alter table time_records      enable row level security;
alter table weekly_summaries  enable row level security;
alter table leave_balances    enable row level security;
alter table leave_requests    enable row level security;
alter table ot_notifications  enable row level security;
alter table ot_audit_logs     enable row level security;

create policy "employees_select_self" on employees for select using (auth.uid() = id);
create policy "employees_select_manager" on employees for select
  using (exists (select 1 from employees mgr where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or employees.manager_id = mgr.id)));
create policy "employees_insert_self" on employees for insert with check (auth.uid() = id);
create policy "employees_update_admin" on employees for update
  using (exists (select 1 from employees where id = auth.uid() and role = 'admin'));

create policy "overtime_requests_select_self" on overtime_requests for select using (employee_id = auth.uid());
create policy "overtime_requests_insert_self" on overtime_requests for insert with check (employee_id = auth.uid() and created_by = auth.uid());
create policy "overtime_requests_update_self" on overtime_requests for update using (employee_id = auth.uid() and status = 'pending');
create policy "overtime_requests_delete_self" on overtime_requests for delete using (employee_id = auth.uid() and status = 'pending');
create policy "overtime_requests_select_manager" on overtime_requests for select
  using (exists (select 1 from employees mgr join employees emp on emp.id = overtime_requests.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));
create policy "overtime_requests_update_manager" on overtime_requests for update
  using (exists (select 1 from employees mgr join employees emp on emp.id = overtime_requests.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));

create policy "time_records_select_self" on time_records for select using (employee_id = auth.uid());
create policy "time_records_select_manager" on time_records for select
  using (exists (select 1 from employees mgr join employees emp on emp.id = time_records.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));

create policy "weekly_summaries_select_self" on weekly_summaries for select using (employee_id = auth.uid());
create policy "weekly_summaries_select_manager" on weekly_summaries for select
  using (exists (select 1 from employees mgr join employees emp on emp.id = weekly_summaries.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));

create policy "leave_balances_select_self" on leave_balances for select using (employee_id = auth.uid());
create policy "leave_balances_select_manager" on leave_balances for select
  using (exists (select 1 from employees mgr join employees emp on emp.id = leave_balances.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));
create policy "leave_balances_update_manager" on leave_balances for update
  using (exists (select 1 from employees mgr join employees emp on emp.id = leave_balances.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));

create policy "leave_requests_select_self" on leave_requests for select using (employee_id = auth.uid());
create policy "leave_requests_insert_self" on leave_requests for insert with check (employee_id = auth.uid());
create policy "leave_requests_update_self" on leave_requests for update using (employee_id = auth.uid() and status = 'pending');
create policy "leave_requests_delete_self" on leave_requests for delete using (employee_id = auth.uid() and status = 'pending');
create policy "leave_requests_select_manager" on leave_requests for select
  using (exists (select 1 from employees mgr join employees emp on emp.id = leave_requests.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));
create policy "leave_requests_update_manager" on leave_requests for update
  using (exists (select 1 from employees mgr join employees emp on emp.id = leave_requests.employee_id where mgr.id = auth.uid() and mgr.role in ('manager','admin') and (mgr.role = 'admin' or emp.manager_id = mgr.id)));

create policy "ot_notifications_select_self" on ot_notifications for select using (recipient_id = auth.uid());
create policy "ot_notifications_update_self" on ot_notifications for update using (recipient_id = auth.uid());

create policy "ot_audit_logs_select_admin" on ot_audit_logs for select
  using (exists (select 1 from employees where id = auth.uid() and role = 'admin'));
create policy "ot_audit_logs_insert_authenticated" on ot_audit_logs for insert with check (auth.uid() is not null);


-- === Migration #2: RLS 재귀 참조 수정 ===

create or replace function public.get_my_role()
returns text language sql security definer stable as $$
  select role from public.employees where id = auth.uid()
$$;

create or replace function public.is_manager_or_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.employees where id = auth.uid() and role in ('manager', 'admin'))
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.employees where id = auth.uid() and role = 'admin')
$$;

drop policy if exists "employees_select_self" on employees;
drop policy if exists "employees_select_manager" on employees;
drop policy if exists "employees_update_admin" on employees;
drop policy if exists "employees_insert_self" on employees;

create policy "employees_select_self" on employees for select using (auth.uid() = id);
create policy "employees_select_manager" on employees for select using (public.is_manager_or_admin());
create policy "employees_insert_self" on employees for insert with check (auth.uid() = id);
create policy "employees_update_admin" on employees for update using (public.is_admin());

drop policy if exists "overtime_requests_select_manager" on overtime_requests;
drop policy if exists "overtime_requests_update_manager" on overtime_requests;
create policy "overtime_requests_select_manager" on overtime_requests for select using (public.is_manager_or_admin());
create policy "overtime_requests_update_manager" on overtime_requests for update using (public.is_manager_or_admin());

drop policy if exists "time_records_select_manager" on time_records;
create policy "time_records_select_manager" on time_records for select using (public.is_manager_or_admin());

drop policy if exists "weekly_summaries_select_manager" on weekly_summaries;
create policy "weekly_summaries_select_manager" on weekly_summaries for select using (public.is_manager_or_admin());

drop policy if exists "leave_balances_select_manager" on leave_balances;
drop policy if exists "leave_balances_update_manager" on leave_balances;
create policy "leave_balances_select_manager" on leave_balances for select using (public.is_manager_or_admin());
create policy "leave_balances_update_manager" on leave_balances for update using (public.is_manager_or_admin());

drop policy if exists "leave_requests_select_manager" on leave_requests;
drop policy if exists "leave_requests_update_manager" on leave_requests;
create policy "leave_requests_select_manager" on leave_requests for select using (public.is_manager_or_admin());
create policy "leave_requests_update_manager" on leave_requests for update using (public.is_manager_or_admin());


-- === Migration #3: register_employee RPC ===

create or replace function public.register_employee(
  p_id uuid, p_name text, p_email text, p_avatar_url text default null
)
returns public.employees language plpgsql security definer as $$
declare
  v_is_first boolean; v_role text; v_active boolean; v_result public.employees;
begin
  select * into v_result from public.employees where id = p_id;
  if found then return v_result; end if;
  select not exists (select 1 from public.employees) into v_is_first;
  if v_is_first then v_role := 'admin'; v_active := true;
  else v_role := 'employee'; v_active := false; end if;
  insert into public.employees (id, name, email, avatar_url, department, role, employee_type, hourly_wage, is_active)
  values (p_id, p_name, p_email, p_avatar_url, '', v_role, 'office', 0, v_active)
  returning * into v_result;
  return v_result;
end;
$$;


-- === Migration #4+5: admin RPC 함수 (name 포함) ===

create or replace function public.list_all_employees(p_admin_key text default null)
returns setof public.employees language plpgsql security definer as $$
begin
  if p_admin_key = '6325' or public.is_admin() then
    return query select * from public.employees order by created_at asc;
  else raise exception 'Unauthorized'; end if;
end;
$$;

create or replace function public.update_employee_admin(
  p_admin_key text default null, p_id uuid default null, p_name text default null,
  p_role text default null, p_department text default null, p_is_active boolean default null
)
returns public.employees language plpgsql security definer as $$
declare v_result public.employees;
begin
  if p_admin_key = '6325' or public.is_admin() then
    update public.employees set
      name = coalesce(p_name, name), role = coalesce(p_role, role),
      department = coalesce(p_department, department),
      is_active = coalesce(p_is_active, is_active), updated_at = now()
    where id = p_id returning * into v_result;
    if not found then raise exception 'Employee not found'; end if;
    return v_result;
  else raise exception 'Unauthorized'; end if;
end;
$$;


-- === Migration #6: leave balance RPC ===

create or replace function list_employee_balances(
  p_admin_key text default null, p_year integer default extract(year from now())::integer
)
returns table (id uuid, name text, department text, total_days numeric, used_days numeric, remaining_days numeric)
language plpgsql security definer as $$
begin
  if p_admin_key = '6325' or is_manager_or_admin() then
    return query
      select e.id, e.name::text, e.department::text,
        coalesce(lb.total_days, 0)::numeric, coalesce(lb.used_days, 0)::numeric, coalesce(lb.remaining_days, 0)::numeric
      from employees e left join leave_balances lb on lb.employee_id = e.id and lb.year = p_year
      where e.is_active = true order by e.name;
  else raise exception 'unauthorized'; end if;
end;
$$;

create or replace function upsert_leave_balance(
  p_employee_id uuid, p_year integer, p_delta numeric, p_admin_key text default null, p_reason text default ''
)
returns setof leave_balances language plpgsql security definer as $$
declare v_existing leave_balances%rowtype;
begin
  if not (p_admin_key = '6325' or is_manager_or_admin()) then raise exception 'unauthorized'; end if;
  select * into v_existing from leave_balances where employee_id = p_employee_id and year = p_year;
  if not found then
    return query insert into leave_balances (employee_id, year, total_days, used_days)
      values (p_employee_id, p_year, greatest(p_delta, 0), 0) returning *;
  else
    return query update leave_balances set total_days = greatest(total_days + p_delta, 0)
      where employee_id = p_employee_id and year = p_year returning *;
  end if;
end;
$$;


-- === Migration #7: expenses 테이블 ===

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  category text NOT NULL CHECK (category IN ('meal', 'transport', 'supplies', 'other')),
  amount integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_select_own" ON expenses FOR SELECT USING (employee_id = auth.uid()::uuid OR is_manager_or_admin());
CREATE POLICY "expenses_insert_own" ON expenses FOR INSERT WITH CHECK (employee_id = auth.uid()::uuid);
CREATE POLICY "expenses_update_admin" ON expenses FOR UPDATE USING (is_manager_or_admin());


-- === Migration #8: manager 급여 수정 권한 ===

DROP POLICY IF EXISTS "employees_update_admin" ON employees;
CREATE POLICY "employees_update_manager_admin" ON employees FOR UPDATE USING (public.is_manager_or_admin());


-- === Migration #10: leave_types 테이블 ===

CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  consumes_annual boolean NOT NULL DEFAULT false,
  annual_days numeric(3,1) NOT NULL DEFAULT 0,
  absence_days numeric(3,1) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_types_select_all" ON leave_types FOR SELECT USING (true);
CREATE POLICY "leave_types_insert_admin" ON leave_types FOR INSERT WITH CHECK (is_manager_or_admin());
CREATE POLICY "leave_types_update_admin" ON leave_types FOR UPDATE USING (is_manager_or_admin());
CREATE POLICY "leave_types_delete_admin" ON leave_types FOR DELETE USING (is_manager_or_admin());

INSERT INTO leave_types (name, consumes_annual, annual_days, absence_days, sort_order) VALUES
  ('휴가', true, 1, 1, 1),
  ('반차', true, 0.5, 0.5, 2),
  ('본인/배우자의 조부모·외조부모·형제 자매 사망', false, 0, 2, 3),
  ('본인/배우자의 부모·배우자 사망', false, 0, 3, 4),
  ('본인 결혼', false, 0, 5, 5),
  ('건강검진', false, 0, 0.5, 6),
  ('예비군/민방위 훈련', false, 0, 1, 7),
  ('배우자 출산', false, 0, 3, 8);

-- ============================================================
-- 여기까지 실행하면 DB 스키마 완료!
-- 다음 단계: dev 계정 생성은 별도 안내 참조
-- ============================================================
