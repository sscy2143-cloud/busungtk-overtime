-- 013 되돌리기. 다른 파일과 독립.
-- 되돌리면 admin, manager 가 REST 로 is_active 를 바꿀 수 있다.
begin;
drop trigger if exists employees_active_server_only
  on public.employees;
drop function if exists public.employees_active_guard();
commit;
