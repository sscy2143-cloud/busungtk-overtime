-- READ ONLY. Security Advisor 0010(Security Definer View) 해소 확인. 아무것도 바꾸지 않는다.
-- [1] public 의 뷰 중 security_invoker 가 켜져 있지 않은 것 (0행이어야 Advisor 0010 이 사라진다)
select c.relname as view_name, coalesce(array_to_string(c.reloptions, ','), '-') as options
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
order by 1;
-- [2] employees_directory: 옵션, 칼럼(6개, 순서), 권한 (anon false, authenticated true), 갱신 불가(0)
select array_to_string(reloptions, ',') as options,
       (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = c.oid and attnum > 0 and not attisdropped) as columns,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
       pg_relation_is_updatable(c.oid, false) as updatable_mask
from pg_class c where c.oid = 'public.employees_directory'::regclass;
-- [3] 전용 함수: definer, search_path 고정, anon 실행 false, authenticated 실행 true, anon 스키마 사용 false
select p.oid::regprocedure::text as fn, p.prosecdef as definer, p.proconfig as config,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_schema_privilege('anon', 'app_private', 'USAGE') as anon_schema_usage
from pg_proc p where p.oid = 'app_private.employees_directory_rows()'::regprocedure;
-- [4] public 스키마 definer 함수 수(67 유지) 와 anon 실행 수(0)
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef) as public_definer,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_exec;
-- [5] employees 표 RLS 와 정책 수 (적용 전후 같아야 함: RLS true)
select relrowsecurity as rls, (select count(*) from pg_policies where schemaname = 'public' and tablename = 'employees') as policies
from pg_class where oid = 'public.employees'::regclass;
