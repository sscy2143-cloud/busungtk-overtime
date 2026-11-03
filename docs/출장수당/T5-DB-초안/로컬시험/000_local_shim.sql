-- ⚠ 로컬 시험 전용. 운영 Supabase 에서 실행 금지 (운영에는 이 객체들이 이미 있다).
-- ============================================================
-- Supabase 가 기본으로 제공하는 것을 빈 PostgreSQL(pglite 등)에 흉내 낸다.
-- 010~040 이 기대는 것: 역할 anon/authenticated/service_role, auth.uid(), update_updated_at_column(),
-- public.employees(id, role, is_active, ...), public.overtime_requests(employee_id, date, planned_start, planned_end, status),
-- public.is_manager_or_admin(), public.is_admin(), public.list_all_employees(), employees 의 RLS 정책
--   (employees 정책·함수는 레포 마이그레이션 20260225210000·20260226100000·20260323000000 의 사본 — 운영 실제 정의는 C-7 대조로 확인)
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- pgcrypto 는 쓰지 않는다 (gen_random_uuid 는 PostgreSQL 13+ 내장). 운영의 pgcrypto 는 extensions 스키마에 있다.

create schema if not exists auth;

-- Supabase 기본 권한 흉내: 이후 public 에 만드는 표·뷰·함수에 anon/authenticated/service_role 권한이 자동으로 붙는다
--   (운영 C-8/S-7 대조 항목. 새 뷰·함수를 만들 때 명시적으로 회수하지 않으면 열린다 — 008a 가 이를 전제로 회수한다)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- 세션 설정값으로 로그인 사용자를 흉내 낸다:  select set_config('request.jwt.claim.sub', '<uuid>', false);
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- service_role 판정용 (trip_store_server_calcs 가 읽는 값):
--   select set_config('request.jwt.claims', '{"role":"service_role"}', false);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 기존 운영 표의 최소 모양 (칼럼 이름·타입은 운영과 같게. 운영 대조 C-6·C-10 뒤 필요하면 고친다)
create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  avatar_url    text,
  department    text not null default '',
  role          text not null default 'employee' check (role in ('employee', 'manager', 'admin')),
  employee_type text not null default 'office',
  hourly_wage   integer not null default 0,
  second_auth_hash text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- 운영 S-2: employees 의 기존 트리거는 employees_updated_at 하나
drop trigger if exists employees_updated_at on public.employees;
create trigger employees_updated_at before update on public.employees for each row execute function public.update_updated_at_column();

create table if not exists public.overtime_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  date           date not null,
  planned_start  text,
  planned_end    text,
  status         text not null default 'pending',
  created_at     timestamptz not null default now()
);

-- (표 다음에 둔다 — SQL 함수는 만들 때 표를 확인한다)
-- 운영 함수 is_manager_or_admin() 사본 (20260225210000): is_active 를 보지 않는다 — 비활성 계정도 세션만 있으면 true (운영 정의는 C-7 대조)
create or replace function public.is_manager_or_admin()
returns boolean
language sql stable security definer
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role in ('manager', 'admin'))
$$;

-- 운영 함수 is_employee() — 마이그레이션에 없고 운영에만 있음 (secpatch 메모: "등록된 직원이면 참"). 정확한 본문은 S-3 결과 기준
create or replace function public.is_employee()
returns boolean
language sql stable security definer
as $$
  select exists (select 1 from public.employees where id = auth.uid())
$$;

-- 운영 RPC register_employee (20260225220000 사본): 첫 직원만 admin, 이후는 employee·비활성
create or replace function public.register_employee(p_id uuid, p_name text, p_email text, p_avatar_url text default null)
returns public.employees
language plpgsql security definer
as $$
declare v_is_first boolean; v_role text; v_active boolean; v_result public.employees;
begin
  select * into v_result from public.employees where id = p_id;
  if found then return v_result; end if;
  select not exists (select 1 from public.employees) into v_is_first;
  if v_is_first then v_role := 'admin'; v_active := true; else v_role := 'employee'; v_active := false; end if;
  insert into public.employees (id, name, email, avatar_url, department, role, employee_type, hourly_wage, is_active)
  values (p_id, p_name, p_email, p_avatar_url, '', v_role, 'office', 0, v_active)
  returning * into v_result;
  return v_result;
end;
$$;

-- 운영 함수 is_admin() (20260225210000 사본: is_active 를 보지 않는다)
create or replace function public.is_admin()
returns boolean
language sql stable security definer
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role = 'admin')
$$;

-- 운영 RPC list_all_employees() (운영 S-3 원문 기준, 11-03: 인자 없음·is_manager_or_admin 판정 — 마이그레이션 사본과 다름): returns setof employees + select *
create or replace function public.list_all_employees()
returns setof public.employees
language plpgsql security definer
as $$
begin
  if public.is_manager_or_admin() then
    return query select * from public.employees order by created_at asc;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$;

-- 운영 RPC update_employee_admin (20260323000000 사본): admin 만, role 등 변경. 트리거(005·006)를 같이 지난다
create or replace function public.update_employee_admin(
  p_admin_key text default null, p_id uuid default null, p_name text default null, p_role text default null,
  p_department text default null, p_is_active boolean default null
)
returns public.employees
language plpgsql security definer
as $$
declare v_result public.employees;
begin
  if public.is_admin() then
    update public.employees
    set name = coalesce(p_name, name), role = coalesce(p_role, role), is_active = coalesce(p_is_active, is_active)
    where id = p_id
    returning * into v_result;
    if not found then raise exception 'Employee not found'; end if;
    return v_result;
  else
    raise exception 'Unauthorized';
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.employees, public.overtime_requests to authenticated, service_role;
grant update on public.employees to authenticated;
grant insert on public.employees to authenticated;

-- 운영 employees RLS (사본): 본인·manager/admin 조회, manager/admin 수정 (20260226100000 — with check 없음)
alter table public.employees enable row level security;
drop policy if exists "employees_select_self" on public.employees;
create policy "employees_select_self" on public.employees for select using (auth.uid() = id);
drop policy if exists "employees_select_manager" on public.employees;
create policy "employees_select_manager" on public.employees for select using (public.is_manager_or_admin());
drop policy if exists "employees_update_manager_admin" on public.employees;
create policy "employees_update_manager_admin" on public.employees for update using (public.is_manager_or_admin());
-- 본인 자동 등록 (사본): role 을 제한하지 않는다
drop policy if exists "employees_insert_self" on public.employees;
create policy "employees_insert_self" on public.employees for insert with check (auth.uid() = id);
-- 운영 payslips (20260306000006 사본, D13 시험용): 파일 경로만, 금액 없음
create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  period      text not null,
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references public.employees(id),
  created_at  timestamptz not null default now(),
  unique (employee_id, period)
);
alter table public.payslips enable row level security;
grant select, insert, update, delete on public.payslips to authenticated, service_role;
drop policy if exists "employees_see_own_payslips" on public.payslips;
create policy "employees_see_own_payslips" on public.payslips for select using (employee_id = auth.uid());
drop policy if exists "admin_manage_payslips" on public.payslips;
create policy "admin_manage_payslips" on public.payslips
  for all using (exists (select 1 from public.employees where id = auth.uid() and role in ('admin', 'manager')));

-- 운영 S-1 (11-03): 마이그레이션에 없는 정책 — 등록된 직원이면 활성 직원 전원의 행(시급·2차인증 해시 포함)을 읽는다
drop policy if exists "employees_select_active_for_group" on public.employees;
create policy "employees_select_active_for_group" on public.employees for select using ((is_active = true) and public.is_employee());

-- 시험용 직원 (id 고정 — 시험 스크립트가 같은 값을 쓴다)
insert into public.employees (id, name, role) values
  ('00000000-0000-0000-0000-000000000001', '김직원', 'employee'),
  ('00000000-0000-0000-0000-000000000002', '이동행', 'employee'),
  ('00000000-0000-0000-0000-000000000009', '박대표', 'admin')
on conflict (id) do nothing;
