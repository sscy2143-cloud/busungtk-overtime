-- ⚠ 운영 적용은 사용자 승인 후. SQL Editor 에 이 파일 전체를 붙여 넣고 한 번에 실행한다 (begin … commit 이 한 배치).
-- 한 배치 안에서 어느 문장이든 실패하면 PostgreSQL 이 전체를 되돌리므로(암묵적 트랜잭션 중단) 반쯤 적용된 상태는 남지 않는다.
-- 적용 직후: 보안점검-읽기전용.sql 실행 → S-6 에서 trigger_role_guard·fn_role_guard·is_admin_checks_active·
--   is_manager_or_admin_checks_active = true, trigger_position_guard·column_position = false(005 는 출장 적용 때) 이면 정상.
-- 장애 시 되돌리기: 906_rollback_role_guard.sql, 907_rollback_active_admin_functions.sql 을 각각 한 번에 실행.
begin;

-- ===== 006_employees_role_guard.sql =====
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

-- ===== 007_active_admin_functions.sql =====
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

-- ===== 적용 확인 (같은 배치, 결과 창에 1행) =====
select
  exists (select 1 from pg_trigger where tgname = 'employees_role_admin_only' and tgrelid = 'public.employees'::regclass) as trigger_role_guard,
  (select pg_get_functiondef(oid) like '%is_active%' from pg_proc where oid = 'public.is_admin()'::regprocedure) as is_admin_checks_active,
  (select pg_get_functiondef(oid) like '%is_active%' from pg_proc where oid = 'public.is_manager_or_admin()'::regprocedure) as is_manager_or_admin_checks_active;

commit;
