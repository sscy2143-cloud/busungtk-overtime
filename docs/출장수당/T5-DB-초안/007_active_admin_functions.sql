-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후 (기존 함수 2개의 정의를 바꾸는 파일, D12).
-- ============================================================
-- 007: is_admin() · is_manager_or_admin() 이 활성(is_active) 계정만 참으로 본다  (2026-11-03)
--
-- 배경: 두 함수(20260225210000 사본)는 role 만 보고 is_active 를 보지 않는다. 퇴사 처리(is_active=false)해도 auth 계정은
--   차단되지 않으므로(운영 11-03 대조: 비활성 3명 모두 미차단, 그중 manager 1명) 남은 세션·재로그인으로
--   employees 수정, overtime 조회·수정, update_employee_admin·list_all_employees·2차 인증 RPC 등 관리자 판정이 그대로 통한다.
--   앱의 ActiveEmployeeGuard 는 화면만 막는다.
-- 방식: 두 함수에 and is_active = true 를 더한다 (정의 교체). 활성 계정의 동작은 그대로이고 비활성 계정만 false 가 된다.
--   본인 행 조회(employees_select_self)는 함수와 무관하므로 비활성 안내 화면은 그대로 뜬다.
-- 주의: 운영의 실제 정의가 사본과 다르면(S-3) 이 파일과 907 을 운영 정의 기준으로 다시 맞춘 뒤 적용한다.
--   payslips 의 admin_manage_payslips 정책은 함수 대신 role in ('admin','manager') 를 직접 쓰므로 이 파일로는 바뀌지 않는다 (급여명세서 정책, 별도 승인 범위).
--   근본 조치는 퇴사 처리 시 auth 계정 차단(banned_until)이며 이는 운영 조치·앱(api/admin-user) 변경으로 따로 결정한다.
-- 독립: 006 과 무관, 907 로 단독 되돌린다.
-- ============================================================
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
