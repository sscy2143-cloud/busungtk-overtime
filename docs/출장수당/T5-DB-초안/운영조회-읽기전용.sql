-- ============================================================
-- 출장수당 T5 적용 전 운영 대조 — 읽기 전용 (SELECT 만)
--   근태관리 Supabase(wvwbaqyxztgcrkiacvql) 대시보드 → SQL Editor 에 통째로 붙여 실행.
--   결과는 항목(item)별 한 행의 JSON 이다. 직원 이름·이메일·급여·신청 내용은 조회하지 않는다 (개수·구조만).
--   REST(OpenAPI)로는 볼 수 없어 2026-11-03 대조에서 '미검증' 으로 남은 C-1·C-3·C-7·C-8·C-9·C-11 을 닫기 위한 것.
-- ============================================================
begin read only;

select 'C-1 version' as item, jsonb_build_object('pg', current_setting('server_version'),
  'extensions', (select jsonb_agg(extname || ' ' || extversion order by extname) from pg_extension)) as result
union all
select 'C-1 auth schema', jsonb_build_object(
  'auth_uid_fn', to_regprocedure('auth.uid()') is not null,
  'auth_jwt_fn', to_regprocedure('auth.jwt()') is not null)
union all
select 'C-2 permission system (expect none)', jsonb_build_object(
  'admin_permissions', to_regclass('public.admin_permissions') is not null,
  'has_admin_permission', to_regprocedure('public.has_admin_permission(text)') is not null,
  'overtime_grace', to_regclass('public.overtime_grace') is not null,
  'payroll_reauth_sessions', to_regclass('public.payroll_reauth_sessions') is not null,
  'overtime_requests_select_manager_qual', (select qual from pg_policies where schemaname = 'public' and tablename = 'overtime_requests' and policyname = 'overtime_requests_select_manager'))
union all
select 'C-3 policy baseline', jsonb_build_object(
  'count_by_table', (select jsonb_object_agg(tablename, n) from (select tablename, count(*) as n from pg_policies where schemaname = 'public' group by tablename) t),
  'employees_policies', (select jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles::text[], 'qual', qual) order by policyname) from pg_policies where schemaname = 'public' and tablename = 'employees'))
union all
select 'C-5 name conflicts (expect empty)', coalesce((select jsonb_agg(x) from (
  select 'table:' || table_name as x from information_schema.tables where table_schema = 'public' and (table_name like 'trip\_%' or table_name = 'holidays')
  union all select 'function:' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'trip\_%' or p.proname like '\_trip\_%')) s), '[]'::jsonb)
union all
select 'C-6 employees', jsonb_build_object(
  'role_counts', (select jsonb_agg(jsonb_build_object('role', role, 'active', is_active, 'n', n) order by role, is_active) from (select role, is_active, count(*) as n from public.employees group by role, is_active) r),
  'id_fk', (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.employees'::regclass and contype = 'f' and conname ilike '%id_fkey%' limit 1),
  'rls_enabled', (select relrowsecurity from pg_class where oid = 'public.employees'::regclass))
union all
select 'C-7 existing functions', (select jsonb_agg(jsonb_build_object('fn', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'secdef', p.prosecdef, 'acl', array_to_string(p.proacl, ','), 'def', case when p.proname in ('is_manager_or_admin', 'is_admin', 'update_updated_at_column') then pg_get_functiondef(p.oid) end) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('update_updated_at_column', 'is_manager_or_admin', 'is_admin', 'get_my_role'))
union all
select 'C-8/C-11 default privileges + roles', jsonb_build_object(
  'default_acl', (select jsonb_agg(jsonb_build_object('role', defaclrole::regrole::text, 'schema', defaclnamespace::regnamespace::text, 'type', defaclobjtype, 'acl', defaclacl::text)) from pg_default_acl),
  'roles', (select jsonb_agg(jsonb_build_object('role', rolname, 'bypassrls', rolbypassrls) order by rolname) from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'postgres')))
union all
select 'C-9 fk on employees (delete rule)', (select jsonb_agg(jsonb_build_object('from', conrelid::regclass::text, 'name', conname, 'on_delete', confdeltype) order by 1) from pg_constraint where contype = 'f' and confrelid = 'public.employees'::regclass)
union all
select 'C-10 overtime_requests', jsonb_build_object(
  'columns', (select jsonb_agg(column_name || ':' || data_type order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'overtime_requests' and column_name in ('employee_id', 'date', 'status', 'planned_start', 'planned_end')),
  'status_check', (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.overtime_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' limit 1))
union all
select 'C-4 approval_history', jsonb_build_object(
  'columns', (select jsonb_agg(column_name || ':' || data_type order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'approval_history'),
  'constraints', (select jsonb_agg(conname || ' ' || pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.approval_history'::regclass),
  'policies', (select jsonb_agg(policyname || ' ' || cmd) from pg_policies where schemaname = 'public' and tablename = 'approval_history'));

rollback;
