-- ============================================================
-- RLS 재귀 참조 수정 + employees INSERT 정책 추가
-- employees 테이블 RLS 정책이 자기 자신을 참조하여 500 에러 발생
-- security definer 함수로 우회
-- ============================================================

-- 1. 헬퍼 함수: 현재 사용자 역할 조회 (RLS 우회)
create or replace function public.get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.employees where id = auth.uid()
$$;

-- 2. 헬퍼 함수: 현재 사용자가 manager/admin인지 확인
create or replace function public.is_manager_or_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.employees
    where id = auth.uid()
      and role in ('manager', 'admin')
  )
$$;

-- 3. 헬퍼 함수: 현재 사용자가 admin인지 확인
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.employees
    where id = auth.uid()
      and role = 'admin'
  )
$$;

-- ============================================================
-- employees 정책 재생성
-- ============================================================

drop policy if exists "employees_select_self" on employees;
drop policy if exists "employees_select_manager" on employees;
drop policy if exists "employees_update_admin" on employees;
drop policy if exists "employees_insert_self" on employees;

-- 본인 조회
create policy "employees_select_self"
  on employees for select
  using (auth.uid() = id);

-- manager/admin: 전체 조회
create policy "employees_select_manager"
  on employees for select
  using (public.is_manager_or_admin());

-- 본인 자동 등록 (첫 Google 로그인)
create policy "employees_insert_self"
  on employees for insert
  with check (auth.uid() = id);

-- admin: 전체 수정
create policy "employees_update_admin"
  on employees for update
  using (public.is_admin());

-- ============================================================
-- overtime_requests 정책 재생성 (재귀 참조 수정)
-- ============================================================

drop policy if exists "overtime_requests_select_manager" on overtime_requests;
drop policy if exists "overtime_requests_update_manager" on overtime_requests;

create policy "overtime_requests_select_manager"
  on overtime_requests for select
  using (public.is_manager_or_admin());

create policy "overtime_requests_update_manager"
  on overtime_requests for update
  using (public.is_manager_or_admin());

-- ============================================================
-- time_records 정책 재생성
-- ============================================================

drop policy if exists "time_records_select_manager" on time_records;

create policy "time_records_select_manager"
  on time_records for select
  using (public.is_manager_or_admin());

-- ============================================================
-- weekly_summaries 정책 재생성
-- ============================================================

drop policy if exists "weekly_summaries_select_manager" on weekly_summaries;

create policy "weekly_summaries_select_manager"
  on weekly_summaries for select
  using (public.is_manager_or_admin());

-- ============================================================
-- leave_balances 정책 재생성
-- ============================================================

drop policy if exists "leave_balances_select_manager" on leave_balances;
drop policy if exists "leave_balances_update_manager" on leave_balances;

create policy "leave_balances_select_manager"
  on leave_balances for select
  using (public.is_manager_or_admin());

create policy "leave_balances_update_manager"
  on leave_balances for update
  using (public.is_manager_or_admin());

-- ============================================================
-- leave_requests 정책 재생성
-- ============================================================

drop policy if exists "leave_requests_select_manager" on leave_requests;
drop policy if exists "leave_requests_update_manager" on leave_requests;

create policy "leave_requests_select_manager"
  on leave_requests for select
  using (public.is_manager_or_admin());

create policy "leave_requests_update_manager"
  on leave_requests for update
  using (public.is_manager_or_admin());
