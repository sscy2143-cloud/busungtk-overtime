-- DRAFT v2. 운영 실행 금지. 별도 승인 필요.
-- 선행 조건: D15 재직 토글 수정(9814ca1) 배포 완료.
-- employees.is_active 는 서버 API 만 바꾼다.
-- 허용: 요청 역할이 service_role 인 경우,
--       또는 세션 사용자가 없고 역할이 anon,
--       authenticated 가 아닌 경우 (SQL Editor).
-- 그 밖에 값이 바뀌면 거부한다.
-- anon 토큰은 사용자 id 가 없어도 허용되지 않는다.
-- 막는 경로:
--   REST 직접 UPDATE (admin, manager)
--   update_employee_admin RPC 의 p_is_active
-- 값이 안 바뀌는 UPDATE 는 통과한다.
-- 되돌리기: 913
begin;
create or replace function public.employees_active_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if new.is_active is not distinct from old.is_active then
    return new;
  end if;
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')
      ::jsonb) ->> 'role');
  if v_role = 'service_role' then return new; end if;
  if auth.uid() is null
     and coalesce(v_role, '') not in ('anon', 'authenticated') then
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
