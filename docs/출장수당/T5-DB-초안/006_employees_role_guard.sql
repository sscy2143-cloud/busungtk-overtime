-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (기존 표 employees 에 트리거를 거는 파일, D11).
-- ============================================================
-- 006: employees.role 은 활성 admin 만 바꾸거나(UPDATE) 'employee' 가 아닌 값으로 만들(INSERT) 수 있다  (2026-11-03)
--
-- 배경 (PGlite 재현, 운영 정책 사본 기준 — 운영 실제 정의는 보안점검-읽기전용.sql S-1·S-3 으로 확인)
--   1) employees_update_manager_admin 정책은 using(is_manager_or_admin()) 뿐이고 with check 가 없다.
--      인사담당(manager)이 REST 로 employees 를 직접 UPDATE 하면 자기·남의 role 을 'admin' 으로 바꿀 수 있다.
--      is_manager_or_admin() 은 is_active 를 보지 않으므로 퇴사(비활성) 인사담당의 남은 세션도 같다.
--   2) employees_insert_self 정책은 with check(auth.uid() = id) 뿐이라, employees 행이 없는 auth 사용자가
--      role='admin' 행을 직접 INSERT 할 수 있다 (운영 11-03 대조: 행 없는 auth 사용자 0명 — 경로는 남아 있다).
--   role 이 admin 이 되면 야근 승인·사용자 관리·급여 화면·api/admin-user·출장 스위치/승인/조회 권한/직급 변경이 전부 열린다.
--
-- 방식: BEFORE INSERT OR UPDATE OF role 트리거 — 005 의 position 가드와 같은 꼴.
--   - UPDATE: 값이 실제로 바뀌고, 세션 사용자(auth.uid)가 있으며, 활성 admin 이 아니면 ROLE_ADMIN_ONLY(42501).
--   - INSERT: 세션 사용자가 있고 role <> 'employee' 이면 활성 admin 만 허용. register_employee(첫 직원 외 employee) 는 통과.
--   - 정책·칼럼 권한·다른 칼럼(이름·부서·시급·입사일·활성)은 그대로 → 인사담당의 기존 업무 유지.
--   - admin 전용 RPC update_employee_admin 은 활성 admin 세션이면 통과. 세션 없는 경로(service_role·SQL Editor)는 통과.
--   - 직원(employee)은 UPDATE 정책이 없어 원래 0행.
-- 독립: 005·007·010~040 과 무관. 출장 도입과 관계없이 먼저 적용해도 되고, 906 으로 단독 되돌린다.
-- 적용: begin; (이 파일) ; 보안점검-읽기전용.sql 의 S-6 확인 ; commit — 문제가 있으면 rollback (DDL 도 트랜잭션 안에서 되돌아간다).
-- ============================================================
create or replace function public.employees_role_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;                                  -- service_role·SQL Editor
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
