-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (D14 1단계: 뷰 추가만 — 기존 정책·권한은 그대로).
-- ============================================================
-- 008a: employees_directory — 활성 직원용 "이름 목록" 뷰 (시급·2차 인증 해시·이메일 없음)  (2026-11-03, 최종 검증판)
--
-- 배경 (운영 S-1·S-4 확정): 정책 employees_select_active_for_group = (is_active = true) AND is_employee()
--   + authenticated 의 employees 표 SELECT 권한 → 로그인한 직원 누구나 활성 직원 전원의 모든 칼럼
--   (hourly_wage, second_auth_hash, email, force_password_change …)을 REST 로 읽을 수 있다 (PGlite 재현).
--   이 정책이 필요한 화면: 야근 그룹 신청의 직원 선택(RequestPage: id, name, department) → hotfix-d14 가 이 뷰를 읽는다.
--
-- 설계
--   - security_invoker = false(명시): 뷰 본문은 뷰 소유자 권한으로 실행된다. SQL Editor 에서 만들면 소유자 = postgres
--     = employees 표 소유자이고 FORCE ROW LEVEL SECURITY 가 아니므로 소유자는 RLS 를 지나지 않는다 → 호출자가 누구든
--     아래 WHERE 가 정한 행·칼럼만 나온다. (security_invoker = true 면 008b 뒤 일반 직원은 본인 행만 보게 된다 — PGlite 확인.)
--   - 호출자 조건: 호출자 본인이 "활성" 직원일 때만(exists … me.is_active). 비활성(퇴사) 계정 세션·행 없는 auth 사용자·anon 은 0행.
--   - security_barrier: 호출자 함수가 WHERE 아래로 밀려 내려가 base 행을 보는 누출을 막는다 (authenticated 는 함수를 만들 수
--     없어 실제 위험은 낮지만 비용이 없으므로 켠다).
--   - 권한: Supabase 기본 권한(default privileges)이 새 뷰에 anon·authenticated·service_role 의 ALL 을 자동 부여한다.
--     이 뷰는 단순 뷰라 자동 갱신 가능(updatable)하므로 INSERT/UPDATE/DELETE 권한이 남으면 소유자 권한으로 base 표를
--     쓰게 된다 → 전부 회수한 뒤 SELECT 만 authenticated·service_role 에 준다. anon·PUBLIC 은 아무 권한도 없다.
--   - 칼럼 노출 범위는 뷰 정의가 고정한다. PostgREST 의 select=·필터는 뷰 칼럼만 쓸 수 있고 hourly_wage 등은
--     "column does not exist" 로 거부된다. 계산 칼럼(뷰 행 타입을 받는 함수)은 없다.
-- 대안 비교: SECURITY DEFINER RPC 도 같은 소유자 전제이고 PostgREST 필터·정렬을 못 쓴다. 칼럼 GRANT 회수는 역할(authenticated)
--   단위라 관리자 화면까지 막힌다. 기존 코드 변경이 가장 작은 뷰를 택했다.
-- 순서: 008a(뷰) → S-6 확인 → hotfix-d14 배포 → 008b(정책 제거). 되돌리기: 뷰만 지우려면 drop view (908 은 최후 수단, 머리말 참조).
-- 기존 기능: 관리자·인사담당 화면은 employees_select_manager 로 base 표(시급 포함)를 계속 읽는다. 본인 행은 employees_select_self.
-- ============================================================
create or replace view public.employees_directory
with (security_invoker = false, security_barrier = true)
as
  select e.id, e.name, e.department, e.role, e.employee_type, e.is_active
  from public.employees e
  where e.is_active = true
    and exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true);

-- 기본 권한으로 자동 부여된 ALL 을 전부 회수하고 SELECT 만 준다 (멱등)
revoke all on public.employees_directory from public, anon, authenticated, service_role;
grant select on public.employees_directory to authenticated, service_role;

comment on view public.employees_directory is '활성 직원용 활성 직원 이름 목록 (시급·인증 정보 없음). employees_select_active_for_group 정책을 대신한다';
