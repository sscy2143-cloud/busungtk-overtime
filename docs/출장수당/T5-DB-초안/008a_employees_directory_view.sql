-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (D14 1단계: 뷰 추가만 — 기존 정책·권한은 그대로).
-- ============================================================
-- 008a: employees_directory — 일반 직원용 "이름 목록" 뷰 (시급·2차 인증 해시·이메일 없음)  (2026-11-03)
--
-- 배경 (운영 S-1·S-4, 11-03 확정): 정책 employees_select_active_for_group = (is_active = true) AND is_employee()
--   + authenticated 의 employees 표 SELECT 권한 → 로그인한 직원 누구나 활성 직원 전원의 모든 칼럼
--   (hourly_wage, second_auth_hash, email, force_password_change …)을 REST 로 읽을 수 있다 (PGlite 재현).
--   이 정책이 필요한 화면은 둘뿐: 야근 그룹 신청의 직원 선택(RequestPage: id, name, department),
--   출장 동행자·이름 표시(TripConnected: id, name, role). 둘 다 이 뷰로 바꾼다.
-- 방식: security_invoker = false(기본값을 명시) — 뷰 본문은 뷰 소유자 권한으로 실행된다. SQL Editor 에서 만들면 소유자는
--   postgres 이고, employees 표의 소유자도 postgres(마이그레이션 실행자)이며 FORCE ROW LEVEL SECURITY 가 아니므로 소유자는
--   RLS 를 지나지 않는다 → 호출자가 누구든 활성 직원의 비민감 칼럼을 돌려준다. (security_invoker = true 로 하면 호출자 RLS 가
--   적용돼 008b 뒤 일반 직원은 본인 행만 보게 된다 — PGlite 로 확인, 쓰면 안 된다.)
--   security_barrier 로 조건 누출을 막고, authenticated·service_role 에게만 SELECT 를 준다 (anon·public 불가).
--   is_employee() 조건을 그대로 두어 "등록된 직원(employees 행 있음)" 만 본다 — 기존 정책과 같은 대상. 행 없는 auth 사용자는 0행.
-- 대안 비교: SECURITY DEFINER RPC(list_employee_directory) 도 같은 전제(소유자가 RLS 를 지나지 않음)에 의존하고 PostgREST 필터·정렬을
--   못 쓰므로, 기존 코드 변경이 가장 작은 뷰를 택했다. 칼럼 단위 GRANT 회수는 역할(authenticated) 단위라 관리자 화면까지 막혀 부적합.
-- 적용 뒤 확인: 보안점검-읽기전용.sql S-6 의 view_employees_directory = true, view_options 에 security_invoker=false 포함,
--   employees_owner_bypasses_rls = true.
-- 순서: 008a(뷰) → 앱 배포(RequestPage·TripConnected 가 뷰를 읽음) → 008b(정책 제거). 되돌리기 908.
-- 기존 기능: 관리자·인사담당 화면은 employees_select_manager 로 base 표(시급 포함)를 계속 읽는다. 본인 행은 employees_select_self.
-- ============================================================
create or replace view public.employees_directory
with (security_invoker = false, security_barrier = true)
as
  select e.id, e.name, e.department, e.role, e.employee_type, e.is_active
  from public.employees e
  where e.is_active = true and public.is_employee();

revoke all on public.employees_directory from public, anon;
grant select on public.employees_directory to authenticated, service_role;

comment on view public.employees_directory is '일반 직원용 활성 직원 이름 목록 (시급·인증 정보 없음). employees_select_active_for_group 정책을 대신한다';
