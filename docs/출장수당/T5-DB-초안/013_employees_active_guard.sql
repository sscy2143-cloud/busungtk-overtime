-- DRAFT. 운영 실행 금지. 별도 승인 필요.
-- employees.is_active 는 서버 API 만 바꾼다.
-- 로그인 세션(auth.uid 있음)이 값을 바꾸면 거부한다.
-- 막는 경로:
--   REST 직접 UPDATE (admin, manager)
--   update_employee_admin RPC 의 p_is_active
-- 이유: 인증 차단(Ban)과 마지막 admin 보호를 우회한다.
-- 통과: service_role 과 SQL Editor (auth.uid 없음).
-- 값이 안 바뀌는 UPDATE 는 통과한다.
-- 되돌리기: 913
begin;
create or replace function public.employees_active_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.is_active is not distinct from old.is_active then
    return new;
  end if;
  raise exception 'ACTIVE_VIA_SERVER_ONLY'
    using detail = 'is_active is changed by server API only',
          errcode = '42501';
end;
$$;
revoke all on function public.employees_active_guard()
  from public, anon, authenticated;
drop trigger if exists employees_active_server_only
  on public.employees;
create trigger employees_active_server_only
  before update of is_active on public.employees
  for each row execute function public.employees_active_guard();
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.employees'::regclass
  and tgname = 'employees_active_server_only';
commit;
