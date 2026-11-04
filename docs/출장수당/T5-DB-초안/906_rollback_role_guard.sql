-- ⚠ 초안. 실행 금지. 006 되돌리기 — 다른 파일과 독립 (언제든 단독 실행 가능).
-- 되돌리면 인사담당이 REST 로 role 을 바꿀 수 있는 상태(기존 운영 정책)로 돌아간다.
drop trigger if exists employees_role_admin_only on public.employees;
drop function if exists public.employees_role_guard();
