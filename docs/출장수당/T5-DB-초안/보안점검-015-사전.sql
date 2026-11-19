-- READ ONLY. 015 적용 전 점검. 아무것도 바꾸지 않는다. 이름·금액은 조회하지 않는다.
-- [1] app_private 스키마가 이미 있는가, 있다면 안에 무엇이 있는가.
--     기대: schema_exists=false (또는 true 이면서 objects=0). 다른 객체가 이미 있으면 적용 전에 알려 주세요.
select exists (select 1 from pg_namespace where nspname = 'app_private') as schema_exists,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private') as relations,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private') as functions;
-- [2] app_private 스키마의 권한 (스키마가 없으면 0행). anon·PUBLIC 에 USAGE 가 있으면 안 된다.
select n.nspname as schema, coalesce(n.nspacl::text, '(기본값: 소유자만)') as acl,
       has_schema_privilege('anon', n.oid, 'USAGE') as anon_usage,
       has_schema_privilege('authenticated', n.oid, 'USAGE') as authenticated_usage
from pg_namespace n where n.nspname = 'app_private';
-- [3] API 에 노출되는 스키마 목록 (Exposed schemas). 'app_private' 가 들어 있으면 안 된다.
--     Supabase 는 이 값을 authenticator 역할 설정(pgrst.db_schemas)에 저장한다. 비어 있으면 대시보드로 확인한다:
--     Dashboard → Project Settings → API (또는 Integrations → Data API → Settings) → "Exposed schemas".
select r.rolname, c as setting
from pg_roles r, unnest(coalesce(r.rolconfig, array[]::text[])) c
where r.rolname = 'authenticator' and c like 'pgrst.db_%';
-- [4] 지금 employees_directory 뷰의 상태. 기대(적용 전): options 에 security_invoker=false, columns 6개, anon_select=false.
select array_to_string(reloptions, ',') as options,
       (select string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum)
          from pg_attribute where attrelid = c.oid and attnum > 0 and not attisdropped) as columns,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
       pg_get_userbyid(c.relowner) as owner
from pg_class c where c.oid = 'public.employees_directory'::regclass;
-- [5] 이름이 겹치는 함수가 이미 있는가 (기대: 0행).
select p.oid::regprocedure::text as existing_function
from pg_proc p where p.proname = 'employees_directory_rows';
-- [6] 012 기준선: public 스키마 SECURITY DEFINER 함수 수(기대 67)와 anon 실행 수(기대 0). 015 는 이 숫자를 바꾸지 않는다.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef) as public_definer,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_exec;
