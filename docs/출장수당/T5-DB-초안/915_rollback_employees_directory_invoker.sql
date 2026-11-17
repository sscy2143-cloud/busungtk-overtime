-- 015 되돌리기: 뷰를 008a 정의(security_invoker=false)로 돌리고 전용 함수를 지운다. 데이터는 건드리지 않는다.
-- 주의: 되돌리면 Advisor Critical 0010 경고가 다시 나타난다.
begin;
create or replace view public.employees_directory
with (security_invoker = false, security_barrier = true)
as
  select e.id, e.name, e.department, e.role, e.employee_type, e.is_active
  from public.employees e
  where e.is_active = true
    and exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true);
revoke all on public.employees_directory from public, anon, authenticated, service_role;
grant select on public.employees_directory to authenticated, service_role;
drop function if exists app_private.employees_directory_rows();
drop schema if exists app_private;   -- 비어 있을 때만 지워진다(다른 객체가 있으면 오류로 중단)
commit;
