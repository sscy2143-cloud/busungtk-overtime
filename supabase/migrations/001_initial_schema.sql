-- ============================================================
-- busungtk-overtime 초기 스키마
-- Supabase / PostgreSQL 호환
-- ============================================================

-- updated_at 자동 갱신 함수
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. employees
-- ============================================================
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

-- ============================================================
-- 2. overtime_requests
-- ============================================================
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
  group_id         uuid,                          -- 그룹 신청 식별자 (같은 그룹은 동일 group_id 공유)
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

-- ============================================================
-- 3. time_records
-- ============================================================
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

-- ============================================================
-- 4. weekly_summaries
-- ============================================================
create table if not exists weekly_summaries (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  week_start    date not null,                   -- 해당 주 월요일
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

-- ============================================================
-- 5. leave_balances
-- ============================================================
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

-- ============================================================
-- 6. leave_requests
-- ============================================================
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

-- ============================================================
-- 7. notifications
-- ============================================================
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references employees(id) on delete cascade,
  type         text not null,                    -- 'overtime_approved', 'leave_rejected', 'weekly_warning', ...
  title        text not null,
  body         text not null default '',
  reference_id uuid,                             -- 관련 요청 ID (overtime/leave)
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_id on notifications(recipient_id);
create index if not exists idx_notifications_is_read      on notifications(recipient_id, is_read);

-- ============================================================
-- 8. audit_logs
-- ============================================================
create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references employees(id) on delete set null,
  action      text not null,                     -- 'approve_overtime', 'reject_leave', 'adjust_balance', ...
  target_type text not null,                     -- 'overtime_request', 'leave_request', 'leave_balance'
  target_id   uuid not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor_id    on audit_logs(actor_id);
create index if not exists idx_audit_logs_target_id   on audit_logs(target_id);
create index if not exists idx_audit_logs_created_at  on audit_logs(created_at desc);

-- ============================================================
-- RLS 활성화
-- ============================================================
alter table employees         enable row level security;
alter table overtime_requests enable row level security;
alter table time_records      enable row level security;
alter table weekly_summaries  enable row level security;
alter table leave_balances    enable row level security;
alter table leave_requests    enable row level security;
alter table notifications     enable row level security;
alter table audit_logs        enable row level security;

-- ============================================================
-- RLS 정책: employees
-- ============================================================

-- 본인 조회
create policy "employees_select_self"
  on employees for select
  using (auth.uid() = id);

-- 관리자(manager/admin): 자기 팀원 조회
create policy "employees_select_manager"
  on employees for select
  using (
    exists (
      select 1 from employees mgr
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or employees.manager_id = mgr.id)
    )
  );

-- admin: 전체 수정
create policy "employees_update_admin"
  on employees for update
  using (
    exists (select 1 from employees where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- RLS 정책: overtime_requests
-- ============================================================

-- 본인 CRUD
create policy "overtime_requests_select_self"
  on overtime_requests for select
  using (employee_id = auth.uid());

create policy "overtime_requests_insert_self"
  on overtime_requests for insert
  with check (employee_id = auth.uid() and created_by = auth.uid());

create policy "overtime_requests_update_self"
  on overtime_requests for update
  using (employee_id = auth.uid() and status = 'pending');

create policy "overtime_requests_delete_self"
  on overtime_requests for delete
  using (employee_id = auth.uid() and status = 'pending');

-- 관리자: 팀원 조회 + 승인/반려
create policy "overtime_requests_select_manager"
  on overtime_requests for select
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = overtime_requests.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

create policy "overtime_requests_update_manager"
  on overtime_requests for update
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = overtime_requests.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- ============================================================
-- RLS 정책: time_records
-- ============================================================

create policy "time_records_select_self"
  on time_records for select
  using (employee_id = auth.uid());

create policy "time_records_select_manager"
  on time_records for select
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = time_records.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- ============================================================
-- RLS 정책: weekly_summaries
-- ============================================================

create policy "weekly_summaries_select_self"
  on weekly_summaries for select
  using (employee_id = auth.uid());

create policy "weekly_summaries_select_manager"
  on weekly_summaries for select
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = weekly_summaries.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- ============================================================
-- RLS 정책: leave_balances
-- ============================================================

create policy "leave_balances_select_self"
  on leave_balances for select
  using (employee_id = auth.uid());

create policy "leave_balances_select_manager"
  on leave_balances for select
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = leave_balances.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- 관리자: 잔여 일수 조정 (update)
create policy "leave_balances_update_manager"
  on leave_balances for update
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = leave_balances.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- ============================================================
-- RLS 정책: leave_requests
-- ============================================================

create policy "leave_requests_select_self"
  on leave_requests for select
  using (employee_id = auth.uid());

create policy "leave_requests_insert_self"
  on leave_requests for insert
  with check (employee_id = auth.uid());

create policy "leave_requests_update_self"
  on leave_requests for update
  using (employee_id = auth.uid() and status = 'pending');

create policy "leave_requests_delete_self"
  on leave_requests for delete
  using (employee_id = auth.uid() and status = 'pending');

create policy "leave_requests_select_manager"
  on leave_requests for select
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = leave_requests.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

create policy "leave_requests_update_manager"
  on leave_requests for update
  using (
    exists (
      select 1 from employees mgr
      join employees emp on emp.id = leave_requests.employee_id
      where mgr.id = auth.uid()
        and mgr.role in ('manager','admin')
        and (mgr.role = 'admin' or emp.manager_id = mgr.id)
    )
  );

-- ============================================================
-- RLS 정책: notifications (본인만 조회/수정)
-- ============================================================

create policy "notifications_select_self"
  on notifications for select
  using (recipient_id = auth.uid());

create policy "notifications_update_self"
  on notifications for update
  using (recipient_id = auth.uid());

-- ============================================================
-- RLS 정책: audit_logs (admin만 조회)
-- ============================================================

create policy "audit_logs_select_admin"
  on audit_logs for select
  using (
    exists (select 1 from employees where id = auth.uid() and role = 'admin')
  );

create policy "audit_logs_insert_authenticated"
  on audit_logs for insert
  with check (auth.uid() is not null);
