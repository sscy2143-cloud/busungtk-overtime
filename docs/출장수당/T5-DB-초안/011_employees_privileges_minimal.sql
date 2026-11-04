-- ⚠ 초안. 실행 금지. 운영 적용은 사용자 승인 후.
-- D16 최소 권한 정리 — public.employees 한 표만, 앱이 쓰지 않는 권한만 회수한다 (RLS 정책은 건드리지 않음).
--   anon          : 전체 회수 (로그인 전에 employees 를 읽는 코드 없음 — AuthContext 는 로그인 뒤 본인 행을 읽는다)
--   authenticated : TRUNCATE·REFERENCES·TRIGGER·DELETE 회수 (앱은 직원 행을 삭제하지 않음 — 퇴사는 is_active=false)
--   남기는 권한   : authenticated 의 SELECT·INSERT·UPDATE (RLS 정책과 006 트리거가 범위를 제한), service_role 전체
-- 멱등 (여러 번 실행해도 같은 결과). 되돌리기: 911_rollback_employees_privileges.sql
begin;
revoke all on table public.employees from anon;
revoke truncate, references, trigger, delete on table public.employees from authenticated;
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'employees'
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by grantee order by grantee;
commit;
