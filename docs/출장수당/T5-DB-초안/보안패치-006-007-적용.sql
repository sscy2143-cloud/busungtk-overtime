-- ⚠ 운영 적용은 사용자 승인 후. SQL Editor 에 이 파일 전체를 붙여 넣고 한 번에 실행한다 (begin … commit 이 한 배치).
-- 한 배치 안에서 어느 문장이든 실패하면(사전 점검의 raise 포함) PostgreSQL 이 전체를 되돌리므로 반쯤 적용된 상태는 남지 않는다.
-- 적용 직후: 보안점검-읽기전용.sql 실행 → S-6 에서 trigger_role_guard·fn_role_guard·is_admin_checks_active·
--   is_manager_or_admin_checks_active·backup_table = true, trigger_position_guard·column_position = false(005 는 출장 적용 때).
-- 되돌리기: 907_rollback_active_admin_functions.sql(보존한 원본 정의로 복원) → 906_rollback_role_guard.sql, 각각 한 번에 실행.
begin;

-- 0. 사전 점검 — 이미 적용됐거나 운영 전제(S-1~S-3)가 달라졌으면 중단 (배치 전체 롤백)
do $chk$
declare v_wc text; v_def text;
begin
  if exists (select 1 from pg_trigger where tgname = 'employees_role_admin_only' and tgrelid = 'public.employees'::regclass) then
    raise exception 'ALREADY_APPLIED' using detail = 'employees_role_admin_only 트리거가 이미 있습니다';
  end if;
  if to_regprocedure('public.employees_role_guard()') is not null then
    raise exception 'ALREADY_APPLIED' using detail = 'employees_role_guard() 가 이미 있습니다';
  end if;
  select pg_get_functiondef('public.is_admin()'::regprocedure) into v_def;
  if v_def like '%is_active%' then raise exception 'ALREADY_APPLIED' using detail = 'is_admin() 에 is_active 가 이미 있습니다'; end if;
  select pg_get_functiondef('public.is_manager_or_admin()'::regprocedure) into v_def;
  if v_def like '%is_active%' then raise exception 'ALREADY_APPLIED' using detail = 'is_manager_or_admin() 에 is_active 가 이미 있습니다'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employees' and policyname = 'employees_update_manager_admin') then
    raise exception 'PRECONDITION_CHANGED' using detail = 'employees_update_manager_admin 정책이 없습니다 (S-1 과 다름)';
  end if;
  select with_check into v_wc from pg_policies where schemaname = 'public' and tablename = 'employees' and policyname = 'employees_update_manager_admin';
  if v_wc is not null then raise exception 'PRECONDITION_CHANGED' using detail = 'employees_update_manager_admin 에 with_check 가 생겼습니다 (S-1 과 다름)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'is_active') then
    raise exception 'PRECONDITION_CHANGED' using detail = 'employees.is_active 칼럼이 없습니다';
  end if;
end $chk$;

-- 1. 원본 정의 보존 — 907 이 여기 저장된 문장을 그대로 실행해 복원한다. 관리자 외 접근 불가(RLS 켜고 정책 없음 + 권한 회수)
create table if not exists public.security_patch_backup (
  id          bigserial primary key,
  patch       text not null,
  object      text not null,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
alter table public.security_patch_backup enable row level security;
revoke all on public.security_patch_backup from public, anon, authenticated, service_role;
revoke all on sequence public.security_patch_backup_id_seq from public, anon, authenticated, service_role;
insert into public.security_patch_backup (patch, object, definition)
select '007', 'is_admin()', pg_get_functiondef('public.is_admin()'::regprocedure)
union all
select '007', 'is_manager_or_admin()', pg_get_functiondef('public.is_manager_or_admin()'::regprocedure);

-- 2. 006_employees_role_guard.sql
create or replace function public.employees_role_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
  if tg_op = 'INSERT' and new.role = 'employee' then return new; end if;
  if not exists (select 1 from public.employees where id = auth.uid() and role = 'admin' and is_active = true) then
    raise exception 'ROLE_ADMIN_ONLY' using detail = '시스템 권한(role)은 대표(admin)만 바꿀 수 있습니다', errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.employees_role_guard() from public, anon, authenticated;

drop trigger if exists employees_role_admin_only on public.employees;
create trigger employees_role_admin_only
  before insert or update of role on public.employees
  for each row execute function public.employees_role_guard();

-- 3. 007_active_admin_functions.sql — 서명·언어·security definer·stable 은 원본과 같고 본문에 is_active 만 더한다.
--    create or replace 는 소유자·GRANT(proacl)·search_path 설정(proconfig)을 그대로 유지한다.
create or replace function public.is_admin()
returns boolean
language sql security definer stable
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role = 'admin' and is_active = true)
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql security definer stable
as $$
  select exists (select 1 from public.employees where id = auth.uid() and role in ('manager', 'admin') and is_active = true)
$$;

-- 4. 적용 확인 (같은 배치, 결과 창에 1행) — 하나라도 false 면 commit 전에 멈출 수 없으므로(한 배치) 적용 뒤 907·906 으로 되돌린다
select
  exists (select 1 from pg_trigger where tgname = 'employees_role_admin_only' and tgrelid = 'public.employees'::regclass) as trigger_role_guard,
  (select pg_get_functiondef(oid) like '%is_active%' from pg_proc where oid = 'public.is_admin()'::regprocedure) as is_admin_checks_active,
  (select pg_get_functiondef(oid) like '%is_active%' from pg_proc where oid = 'public.is_manager_or_admin()'::regprocedure) as is_manager_or_admin_checks_active,
  (select count(*) from public.security_patch_backup where patch = '007') as backup_rows;

commit;
