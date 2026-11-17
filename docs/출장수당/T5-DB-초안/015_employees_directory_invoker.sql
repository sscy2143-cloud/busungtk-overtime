-- ⚠ 운영 적용은 사용자 승인 후. D14 후속: Supabase Security Advisor 0010(Security Definer View) 해소.
-- ============================================================
-- 015: employees_directory 를 security_invoker=true 뷰로 바꾸고, 권한 처리는 비노출 스키마의 전용 함수로 옮긴다.
--
-- 위험(현재): 뷰가 security_invoker=false(소유자 postgres 권한으로 실행) → Advisor Critical 0010.
-- 해결: 뷰 이름·칼럼 6개·칼럼 타입·호출 방식(select/eq/neq/not/order)은 그대로 두고, 뷰 본문을
--       app_private.employees_directory_rows() 호출로 바꾼다. 이 함수만 SECURITY DEFINER 이고 PostgREST 에 노출되지 않는
--       스키마(app_private)에 있다. employees 표의 RLS·정책·권한은 하나도 바꾸지 않는다.
-- 보안 조건(함수 본문): 호출자가 실제 로그인 사용자(auth.uid() 있음)이고 employees 에 활성으로 있어야 하며,
--       반환 행도 활성 직원이다. 반환 칼럼은 6개(id, name, department, role, employee_type, is_active)뿐.
--       search_path 고정, PUBLIC·anon EXECUTE 없음, authenticated·service_role 만 EXECUTE.
-- 기존 앱(배포된 코드)은 변경 없이 동작한다. 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다.
-- 되돌리기: 915_rollback_employees_directory_invoker.sql
-- ============================================================
begin;

do $pre$
begin
  if to_regclass('public.employees_directory') is null then raise exception 'PRECONDITION missing_008_directory_view'; end if;
  if to_regclass('public.employees') is null then raise exception 'PRECONDITION missing_employees'; end if;
end
$pre$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.employees_directory_rows()
returns table (
  id            public.employees.id%type,
  name          public.employees.name%type,
  department    public.employees.department%type,
  role          public.employees.role%type,
  employee_type public.employees.employee_type%type,
  is_active     public.employees.is_active%type
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select e.id, e.name, e.department, e.role, e.employee_type, e.is_active
  from public.employees e
  where auth.uid() is not null
    and e.is_active = true
    and exists (select 1 from public.employees me where me.id = auth.uid() and me.is_active = true)
$fn$;

revoke all on function app_private.employees_directory_rows() from public, anon, authenticated, service_role;
grant execute on function app_private.employees_directory_rows() to authenticated, service_role;

create or replace view public.employees_directory
with (security_invoker = true, security_barrier = true)
as
  select d.id, d.name, d.department, d.role, d.employee_type, d.is_active
  from app_private.employees_directory_rows() d;

revoke all on public.employees_directory from public, anon, authenticated, service_role;
grant select on public.employees_directory to authenticated, service_role;
comment on view public.employees_directory is '활성 직원용 활성 직원 이름 목록 (시급·인증 정보 없음). 권한 처리는 app_private.employees_directory_rows() (015)';

do $post$
declare v_cols text;
begin
  if coalesce((select reloptions::text from pg_class where oid = 'public.employees_directory'::regclass), '') not like '%security_invoker=true%' then
    raise exception 'POSTCONDITION view_not_invoker';
  end if;
  select string_agg(attname, ',' order by attnum) into v_cols from pg_attribute
   where attrelid = 'public.employees_directory'::regclass and attnum > 0 and not attisdropped;
  if v_cols <> 'id,name,department,role,employee_type,is_active' then raise exception 'POSTCONDITION view_columns %', v_cols; end if;
  if has_table_privilege('anon', 'public.employees_directory', 'SELECT') then raise exception 'POSTCONDITION anon_select'; end if;
  if has_function_privilege('anon', 'app_private.employees_directory_rows()', 'EXECUTE') then raise exception 'POSTCONDITION anon_execute'; end if;
  if has_schema_privilege('anon', 'app_private', 'USAGE') then raise exception 'POSTCONDITION anon_schema_usage'; end if;
  if not (select prosecdef from pg_proc where oid = 'app_private.employees_directory_rows()'::regprocedure) then raise exception 'POSTCONDITION not_definer'; end if;
  if (select proconfig::text from pg_proc where oid = 'app_private.employees_directory_rows()'::regprocedure) is null then raise exception 'POSTCONDITION no_search_path'; end if;
  if pg_relation_is_updatable('public.employees_directory'::regclass, false) <> 0 then raise exception 'POSTCONDITION view_updatable'; end if;
end
$post$;

commit;
